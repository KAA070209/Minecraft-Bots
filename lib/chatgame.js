'use strict';

const fs = require('fs');
const path = require('path');
const { solveMath } = require('./solver');

const DEFAULTS = {
  enabled: false,
  delayMs: 20,
  minIntervalMs: 700,
  maxQueue: 5,
  solo: true,
  soloWindowMs: 10000,
  fuzzyThreshold: 0.84,
  dedupeMs: 3000,
  maxAnswerLength: 48,
  minRiddleChars: 4,
  minResidueChars: 6,
  mathFirst: true,
  debugRaw: false,
  storeFile: null,
  answersFile: null,
  patterns: {
    detect: '(chat\\s*games?|tebak|guess|riddle|谜语|謎語)',
    reveal: 'jawaban\\s*:\\s*(.+)',
    ignore: '(hadiah|tercepat|berhasil|terkirim|peringkat|per peringkat|selamat|menang|kalah|memperoleh|pemenang|\\bskor\\b|\\bboard\\b|\\btop\\s*\\d|untuk\\s+peringkat)'
  },
  api: {
    enabled: true,
    endpoint: '',
    apiKey: '',
    model: 'gpt-4o-mini',
    maxTokens: 16,
    timeoutMs: 1500,
    systemPrompt: 'Kamu menjawab soal game chat. Balas HANYA jawaban final, satu kata atau satu angka, tanpa tanda kutip, tanpa penjelasan, tanpa satuan.'
  }
};

function mergePatterns(patterns) {
  return { ...DEFAULTS.patterns, ...(patterns || {}) };
}
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) / Math.max(m, n) > 0.5) return tokenOverlap(a, b);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

function tokenOverlap(a, b) {
  const left = new Set(a.split(' ').filter(Boolean));
  const right = new Set(b.split(' ').filter(Boolean));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / new Set([...left, ...right]).size;
}

function scoreMatch(a, b) {
  return Math.max(similarity(a, b), tokenOverlap(a, b));
}

function cleanAnswer(raw, maxLength) {
  let text = String(raw || '').replace(/[\r\n]+/g, ' ').trim();
  const bracket = text.match(/[\[(]([^\])]{2,})[\])]/);
  if (bracket) text = bracket[1].trim();
  text = text.replace(/^["'`*_]+|["'`*_.,!?]+$/g, '').trim();
  if (text.length > maxLength) text = text.slice(0, maxLength).trim();
  return text;
}

function buildMatcher(pattern, flags) {
  if (pattern instanceof RegExp) return pattern;
  try {
    return new RegExp(String(pattern), flags);
  } catch {
    return new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }
}

const sharedLocks = new Map();

function acquireSharedLock(key, windowMs) {
  const now = Date.now();
  if (now - (sharedLocks.get(key) || 0) < windowMs) return false;
  sharedLocks.set(key, now);
  if (sharedLocks.size > 500) {
    for (const [k, at] of sharedLocks) if (now - at > windowMs * 4) sharedLocks.delete(k);
  }
  return true;
}

// Teks soal sering disembunyikan di hoverEvent, yang tidak muncul di messagestr.
function extractChatText(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractChatText).join('');
  if (typeof node !== 'object') return '';
  let out = '';
  if (typeof node.text === 'string') out += node.text;
  if (node.extra) out += extractChatText(node.extra);
  const hover = node.hoverEvent || node.hover;
  if (hover) {
    const payload = hover.value !== undefined ? hover.value : hover;
    const text = extractChatText(payload.contents !== undefined ? payload.contents : payload);
    if (text && !out.includes(text)) out += ` ${text}`;
  }
  return out;
}

function isInformative(text, settings) {
  const key = normalize(text);
  if (!key) return false;
  let residue = key;
  try {
    const detect = buildMatcher(settings.patterns.detect, 'i');
    residue = key.replace(new RegExp(detect.source, 'gi'), ' ').replace(/\s+/g, ' ').trim();
  } catch {
    /* pakai key mentah */
  }
  if (/\d/.test(residue)) return true;
  return residue.length >= (settings.minResidueChars || 6);
}

// Buang dekorasi/header supaya AI menerima isi soal saja.
function cleanQuestion(text, settings) {
  let out = String(text || '')
    // Karakter rusak dari dekode mojibake server tidak pernah berarti apa pun.
    .replace(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/[\u2500-\u257F\u25A0-\u25FF\u2580-\u259F]/g, ' ')
    .replace(/[═─━_\-*=~#•·|/\\]{2,}/g, ' ')
    .replace(/[★☆♦♥❖✦✧»«✔✔✖]/g, ' ')
    .replace(/[ \t]+/g, ' ');
  try {
    const detect = buildMatcher(settings.patterns.detect, 'i');
    out = out.replace(new RegExp(detect.source, 'gi'), ' ');
  } catch {
    /* biarkan */
  }
  return out.replace(/\s+/g, ' ').trim();
}

async function resolveApi(settings, riddle, logger) {
  const api = settings.api || {};
  const endpoint = api.endpoint || process.env.MC_AI_ENDPOINT || '';
  const apiKey = api.apiKey || process.env.MC_AI_KEY || '';
  if (!api.enabled || !endpoint || !apiKey) return null;
  const log = logger || { warn() {}, info() {}, success() {} };
  const question = cleanQuestion(riddle, settings);
  if (!question) return null;

  const controller = new AbortController();
  const timerAbort = setTimeout(() => controller.abort(), Number(api.timeoutMs) || 8000);
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: api.model || process.env.MC_AI_MODEL || 'gpt-4o-mini',
        temperature: 0,
        max_tokens: Number(api.maxTokens) || 16,
        messages: [
          { role: 'system', content: api.systemPrompt },
          { role: 'user', content: question }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      log.warn(`chat-game: API ${response.status} (${Date.now() - startedAt}ms)`);
      return null;
    }
    const data = await response.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    const answer = cleanAnswer(text, settings.maxAnswerLength);
    if (answer) log.info(`chat-game: AI jawab dalam ${Date.now() - startedAt}ms -> "${answer}"`);
    return answer || null;
  } catch (err) {
    log.warn(`chat-game: API gagal setelah ${Date.now() - startedAt}ms: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timerAbort);
  }
}

// Satu kali solving tanpa bot: dipakai perintah console "solve".
async function solveOnce(text, config, logger) {
  const settings = { ...DEFAULTS, ...(config.chatGame || {}), patterns: mergePatterns(config.chatGame && config.chatGame.patterns) };
  if (settings.mathFirst !== false) {
    const math = solveMath(text);
    if (math) return { answer: math.answer, source: 'math', expression: math.expression };
  }
  const answer = await resolveApi(settings, text, logger);
  if (answer) return { answer, source: 'api' };
  return { answer: null, source: 'none' };
}

function createChatGameAgent({ config, logger, username }) {
  const settings = { ...DEFAULTS, ...(config.chatGame || {}), patterns: mergePatterns(config.chatGame && config.chatGame.patterns) };
  const detectRe = buildMatcher(settings.patterns.detect, 'i');
  const revealRe = buildMatcher(settings.patterns.reveal, 'i');
  const ignoreRe = buildMatcher(settings.patterns.ignore, 'i');

  const memory = new Map();
  const seen = new Map();
  const userKey = String(username || 'default').replace(/[^A-Za-z0-9_.-]/g, '_');
  const resolveFile = (file) => (file ? path.resolve(String(file).replace(/\{username\}/g, userKey)) : null);
  const storePath = resolveFile(settings.storeFile);
  const answersPath = resolveFile(settings.answersFile);
  let botRef = null;
  const queue = [];
  let pumpTimer = null;
  let lastSentAt = 0;
  let roundStartedAt = 0;
  let currentRiddle = null;
  const stats = { rounds: 0, answered: 0, learned: 0, misses: 0, apiCalls: 0, lastLatencyMs: 0 };

  function loadStore() {
    if (!storePath) return;
    try {
      if (!fs.existsSync(storePath)) return;
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) memory.set(k, v);
      logger.info(`chat-game: ${memory.size} jawaban tersimpan dari ${path.basename(storePath)}`);
    } catch (err) {
      logger.warn(`chat-game: gagal baca store: ${err.message}`);
    }
  }

  function saveStore() {
    if (!storePath) return;
    try {
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify(Object.fromEntries(memory), null, 2));
    } catch (err) {
      logger.warn(`chat-game: gagal simpan store: ${err.message}`);
    }
  }

  function loadAnswersFile() {
    if (!answersPath) return;
    try {
      if (!fs.existsSync(answersPath)) return;
      const parsed = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : [];
      for (const row of list) {
        if (row && row.riddle && row.answer) {
          memory.set(normalize(row.riddle), cleanAnswer(row.answer, settings.maxAnswerLength));
          stats.learned += 1;
        }
      }
      if (list.length) logger.info(`chat-game: ${list.length} jawaban dari ${path.basename(answersPath)}`);
    } catch (err) {
      logger.warn(`chat-game: gagal baca answersFile: ${err.message}`);
    }
  }

  function lookup(riddle) {
    const key = normalize(riddle);
    if (!key) return null;
    if (memory.has(key)) return { answer: memory.get(key), source: 'exact' };
    let best = null;
    for (const [stored, answer] of memory) {
      const score = scoreMatch(key, stored);
      if (score >= settings.fuzzyThreshold && (!best || score > best.score)) {
        best = { answer, source: 'fuzzy', score };
      }
    }
    return best;
  }

  async function askApi(riddle) {
    stats.apiCalls += 1;
    const answer = await resolveApi(settings, riddle, logger);
    return answer;
  }

  function send(answer) {
    if (!botRef || !botRef.entity) return false;
    queue.push(answer);
    while (queue.length > (settings.maxQueue || 5)) queue.shift();
    pump();
    return true;
  }

  function pump() {
    if (pumpTimer || !queue.length) return;
    const wait = Math.max(settings.delayMs || 0, settings.minIntervalMs - (Date.now() - lastSentAt));
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      const next = queue.shift();
      if (next && botRef && botRef.entity) {
        try {
          botRef.chat(next);
          lastSentAt = Date.now();
          stats.answered += 1;
          if (roundStartedAt) {
            const elapsed = lastSentAt - roundStartedAt;
            stats.lastLatencyMs = elapsed;
            logger.success(`chat-game: jawab "${next}" (${elapsed}ms setelah soal muncul)`);
            roundStartedAt = 0;
          } else {
            logger.success(`chat-game: jawab "${next}"`);
          }
        } catch (err) {
          logger.warn(`chat-game: gagal kirim: ${err.message}`);
        }
      }
      pump();
    }, Math.max(0, wait));
  }

  function learn(riddle, rawAnswer) {
    if (!riddle) return false;
    // Pesan info server (hadiah, pemenang, peringkat) tidak boleh jadi kunci
    // hafalan: kalau bocor, bot akan "mengenali" pesan itu dan mengulang
    // jawaban basi ke chat.
    if (ignoreRe.test(riddle)) {
      logger.info(`chat-game: tidak menghafal "${normalize(riddle).slice(0, 40)}" - bukan soal`);
      return false;
    }
    if (!isInformative(riddle, settings)) {
      logger.info(`chat-game: tidak menghafal "${normalize(riddle).slice(0, 40)}" - tidak ada isi soal`);
      return false;
    }
    const answer = cleanAnswer(rawAnswer, settings.maxAnswerLength);
    if (!answer) return false;
    const key = normalize(riddle);
    if (!key || memory.get(key) === answer) return false;
    memory.set(key, answer);
    stats.learned += 1;
    logger.info(`chat-game: hafal "${key.slice(0, 60)}" -> "${answer}"`);
    saveStore();
    return true;
  }

  function claimSolo(riddle) {
    if (!settings.solo) return true;
    if (acquireSharedLock(normalize(riddle), settings.soloWindowMs || 10000)) return true;
    logger.info('chat-game: dilewati, bot lain sudah menjawab soal ini');
    return false;
  }

  async function handleRiddle(riddle) {
    currentRiddle = riddle;
    const lastSeen = seen.get(riddle) || 0;
    if (Date.now() - lastSeen < (settings.dedupeMs || 3000)) return null;
    seen.set(riddle, Date.now());
    stats.rounds += 1;
    roundStartedAt = Date.now();

    if (settings.mathFirst) {
      const math = solveMath(riddle);
      if (math) {
        if (!claimSolo(riddle)) return { type: 'skipped', answer: math.answer };
        logger.info(`chat-game: hitung sendiri "${math.expression}" = ${math.answer}`);
        send(math.answer);
        return { type: 'answered', answer: math.answer, source: 'math' };
      }
    }

    const hit = lookup(riddle);
    if (hit) {
      if (!claimSolo(riddle)) return { type: 'skipped', answer: hit.answer };
      logger.info(`chat-game: soal dikenali (${hit.source}${hit.score ? ` ${hit.score.toFixed(2)}` : ''}), jawab "${hit.answer}"`);
      send(hit.answer);
      return { type: 'answered', answer: hit.answer, source: hit.source };
    }
    logger.info(`chat-game: soal baru, pakai AI: "${normalize(riddle).slice(0, 60)}"`);
    const fromApi = await askApi(riddle);
    if (fromApi) {
      if (!claimSolo(riddle)) return { type: 'skipped', answer: fromApi };
      // Jawaban AI adalah tebakan, tidak disimpan sebagai fakta: hanya jawaban
      // yang dibocorkan server ("Jawaban: ...") yang boleh dihafal.
      send(fromApi);
      return { type: 'answered', answer: fromApi, source: 'api' };
    }
    stats.misses += 1;
    return { type: 'unknown', riddle };
  }

  function handleChat(message) {
    if (!settings.enabled) return null;
    const reveal = message.match(revealRe);
    if (reveal) {
      const answer = cleanAnswer(reveal[1], settings.maxAnswerLength);
      const learned = learn(currentRiddle, answer);
      // Habiskan sekali pakai supaya jawaban bocor berikutnya tidak
      // mengaitkan diri ke soal ronde yang sudah lewat.
      currentRiddle = null;
      return { type: 'reveal', answer, learned };
    }
    if (detectRe.test(message) && isInformative(message, settings)) {
      // Pesan info server (hadiah, peringkat, pemenang) bukan soal.
      if (ignoreRe.test(message)) {
        logger.info('chat-game: diabaikan (pesan info server)');
        return null;
      }
      const riddle = message.replace(/\s+/g, ' ').trim();
      void handleRiddle(riddle);
      return { type: 'riddle', riddle };
    }
    return null;
  }

  function handleJson(jsonMsg) {
    if (!settings.enabled) return null;
    if (settings.debugRaw) {
      const flat = extractChatText(jsonMsg);
      if (flat) logger.info(`chat-game raw: ${JSON.stringify(jsonMsg).slice(0, 600)} | teks: ${flat}`);
    }
    return handleChat(extractChatText(jsonMsg));
  }

  // Action bar / title tidak memuat kata "chat games". Isinya bisa kode polos
  // ("xx317Q"), kalimat pengantar ("Ketik kode: xx317Q"), atau hitungan.
  const bareCodeRe = /^[A-Za-z0-9?]{3,32}$/;
  const codeTokenRe = /\b(?=[A-Za-z0-9?]*\d)(?=[A-Za-z0-9?]*[A-Za-z])[A-Za-z0-9?]{4,32}\b/g;
  function handleScreen(text, source) {
    if (!settings.enabled) return null;
    const raw = typeof text === 'string' ? text : extractChatText(text);
    if (!raw) return null;
    if (settings.debugRaw) logger.info(`chat-game ${source}: ${raw}`);
    const flat = raw.replace(/\s+/g, ' ').trim();
    if (!flat) return null;
    if (ignoreRe.test(flat)) return null;
    if (revealRe.test(flat)) return handleChat(flat);
    if (detectRe.test(flat) && isInformative(flat, settings)) return handleChat(flat);
    if (bareCodeRe.test(flat) && /\d/.test(flat)) {
      void handleRiddle(flat);
      return { type: 'riddle', riddle: flat, source };
    }
    if (settings.mathFirst) {
      const math = solveMath(flat);
      if (math) {
        void handleRiddle(flat);
        return { type: 'riddle', riddle: flat, source, math: math.answer };
      }
    }
    const code = (flat.match(codeTokenRe) || []).find((t) => !/^\d+$/.test(t) && !ignoreRe.test(t));
    if (code) {
      void handleRiddle(code);
      return { type: 'riddle', riddle: code, source };
    }
    return null;
  }

  function start(bot) {
    stop();
    botRef = bot;
    loadStore();
    loadAnswersFile();
  }

  function stop() {
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpTimer = null;
    queue.length = 0;
    botRef = null;
    currentRiddle = null;
    roundStartedAt = 0;
  }

  loadStore();
  loadAnswersFile();

  return { handleChat, handleJson, handleScreen, start, stop, stats, memory, lookup, learn, normalize, settings };
}

module.exports = {
  createChatGameAgent,
  solveOnce,
  resolveApi,
  cleanQuestion,
  normalize,
  similarity,
  tokenOverlap,
  scoreMatch,
  cleanAnswer,
  extractChatText,
  isInformative,
  DEFAULTS
};
