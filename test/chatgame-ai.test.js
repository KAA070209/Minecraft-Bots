'use strict';

// Menguji jalur AI dengan fetch di-stub: tidak butuh kunci sungguhan.
const { createChatGameAgent, solveOnce, cleanQuestion, DEFAULTS } = require('../lib/chatgame');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass += 1;
  else fail += 1;
  process.stdout.write(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}

const silent = { info() {}, warn() {}, success() {}, raw() {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const realFetch = global.fetch;

function stubFetch(handler) {
  global.fetch = async (url, options) => handler(url, options);
}
function reply(text, status = 200) {
  stubFetch(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content: text } }] })
  }));
}

const apiConfig = (over = {}) => ({
  chatGame: {
    enabled: true, delayMs: 1, minIntervalMs: 0, solo: false, storeFile: null,
    api: { enabled: true, endpoint: 'https://ai.test/v1/chat/completions', apiKey: 'k-test', ...over }
  }
});

process.stdout.write('[ai] cleanQuestion membuang header & dekorasi\n');
{
  const s = { patterns: DEFAULTS.patterns };
  check('header dibuang', !cleanQuestion('CHAT GAMES Guess the word', s).toLowerCase().includes('chat games'), cleanQuestion('CHAT GAMES Guess the word', s));
  check('garis dekoratif dibuang', !cleanQuestion('════ CHAT GAMES ════ soal', s).includes('═'), cleanQuestion('════ CHAT GAMES ════ soal', s));
  check('isi soal dipertahankan', cleanQuestion('CHAT GAMES 45 + 17', s) === '45 + 17', cleanQuestion('CHAT GAMES 45 + 17', s));
  check('spasi dirapatkan', cleanQuestion('CHAT GAMES   a    b', s) === 'a b', cleanQuestion('CHAT GAMES   a    b', s));
}

process.stdout.write('\n[ai] solveOnce memakai math lebih dulu\n');
(async () => {
  reply('TIDAK DIGUNAKAN');
  const mathFirst = await solveOnce('CHAT GAMES 45 + 17 = ?', apiConfig(), silent);
  check('math menang tanpa API', mathFirst.source === 'math' && mathFirst.answer === '62', JSON.stringify(mathFirst));

  process.stdout.write('\n[ai] solveOnce jatuh ke AI untuk teka-teki\n');
  let seen = null;
  stubFetch(async (url, options) => {
    seen = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Sunflower' } }] }) };
  });
  const riddle = await solveOnce('CHAT GAMES Guess the word: punya kelopak kuning dan berbau harum', apiConfig(), silent);
  check('AI menjawab', riddle.source === 'api' && riddle.answer === 'Sunflower', JSON.stringify(riddle));
  check('prompt dibersihkan dari header', !seen.messages[1].content.toLowerCase().includes('chat games'), seen.messages[1].content);
  check('max_tokens membatasi jawaban', seen.max_tokens === 16, String(seen.max_tokens));
  check('temperature 0', seen.temperature === 0, String(seen.temperature));
  check('model terkirim', typeof seen.model === 'string' && seen.model.length > 0, seen.model);

  process.stdout.write('\n[ai] agent otomatis menjawab teka-teki tanpa setting\n');
  {
    reply('Matahari');
    const sent = [];
    const agent = createChatGameAgent({ config: apiConfig(), logger: silent, username: 'AzkaSaadi' });
    agent.start({ entity: {}, chat: (m) => sent.push(m) });
    agent.handleChat('CHAT GAMES Guess the word: benda paling terang di langit');
    await wait(120);
    check('jawaban terkirim otomatis', sent[0] === 'Matahari', sent.join(','));
    check('tercatat sebagai answered', agent.stats.answered === 1, String(agent.stats.answered));
    check('AI dipanggil', agent.stats.apiCalls === 1, String(agent.stats.apiCalls));
    check('tanpa memory', agent.memory.size === 0, String(agent.memory.size));
  }

  process.stdout.write('\n[ai] agent: matematika tetap lokal & instan\n');
  {
    stubFetch(async () => { throw new Error('AI tidak boleh dipanggil untuk soal matematika'); });
    const sent = [];
    const agent = createChatGameAgent({ config: apiConfig(), logger: silent, username: 'AzkaSaadi' });
    agent.start({ entity: {}, chat: (m) => sent.push(m) });
    agent.handleChat('CHAT GAMES 45 + 17 = ?');
    await wait(60);
    check('jawab 62 tanpa API', sent[0] === '62', sent.join(','));
    check('AI tidak dipanggil', agent.stats.apiCalls === 0, String(agent.stats.apiCalls));
  }

  process.stdout.write('\n[ai] kegagalan API tidak membuat bot diam atau crash\n');
  {
    stubFetch(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    const sent = [];
    const agent = createChatGameAgent({ config: apiConfig(), logger: silent, username: 'AzkaSaadi' });
    agent.start({ entity: {}, chat: (m) => sent.push(m) });
    agent.handleChat('CHAT GAMES Guess the word: teka-teki Misterius');
    await wait(120);
    check('tidak ada jawaban salah saat API gagal', sent.length === 0, sent.join(','));
    check('dicatat sebagai miss', agent.stats.misses === 1, String(agent.stats.misses));

    stubFetch(async () => { throw new Error('jaringan putus'); });
    const sent2 = [];
    const agent2 = createChatGameAgent({ config: apiConfig(), logger: silent, username: 'AzkaSaadi' });
    agent2.start({ entity: {}, chat: (m) => sent2.push(m) });
    agent2.handleChat('CHAT GAMES Guess the word: teka-teki lain');
    await wait(120);
    check('error jaringan tidak crash', sent2.length === 0, sent2.join(','));
  }

  process.stdout.write('\n[ai] tanpa kredensial -> Give up dengan rapi\n');
  {
    const savedKey = process.env.MC_AI_KEY;
    const savedEndpoint = process.env.MC_AI_ENDPOINT;
    delete process.env.MC_AI_KEY;
    delete process.env.MC_AI_ENDPOINT;
    let called = false;
    stubFetch(async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; });
    const noCreds = { chatGame: { enabled: true, api: { enabled: true, endpoint: '', apiKey: '' } } };
    const result = await solveOnce('CHAT GAMES Guess the word: apa ini', noCreds, silent);
    check('tidak memanggil API tanpa kredensial', called === false);
    check('jawaban null', result.answer === null && result.source === 'none', JSON.stringify(result));
    const off = { chatGame: { enabled: true, api: { enabled: false, endpoint: 'https://x', apiKey: 'k' } } };
    await solveOnce('CHAT GAMES Guess the word: apa itu', off, silent);
    check('api.enabled=false tidak memanggil', called === false);
    if (savedKey !== undefined) process.env.MC_AI_KEY = savedKey;
    if (savedEndpoint !== undefined) process.env.MC_AI_ENDPOINT = savedEndpoint;
  }

  process.stdout.write('\n[ai] kredensial dari env dipakai\n');
  {
    delete process.env.MC_AI_KEY;
    process.env.MC_AI_ENDPOINT = 'https://env.test/v1/chat/completions';
    process.env.MC_AI_KEY = 'k-env';
    let authHeader = null;
    stubFetch(async (url, options) => {
      authHeader = options.headers.authorization;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Api' } }] }) };
    });
    const result = await solveOnce('CHAT GAMES Guess the word: api env', {
      chatGame: { enabled: true, api: { enabled: true, endpoint: '', apiKey: '' } }
    }, silent);
    check('MC_AI_KEY dipakai', authHeader === 'Bearer k-env', String(authHeader));
    check('jawaban dari env', result.answer === 'Api', JSON.stringify(result));
    delete process.env.MC_AI_ENDPOINT;
    delete process.env.MC_AI_KEY;
  }

  process.stdout.write('\n[ai] solo: hanya satu bot menjawab per soal\n');
  {
    const mk = (name) => {
      const sent = [];
      const agent = createChatGameAgent({ config: { ...apiConfig(), chatGame: { ...apiConfig().chatGame, solo: true, soloWindowMs: 5000 } }, logger: silent, username: name });
      agent.start({ entity: {}, chat: (m) => sent.push(m) });
      return { agent, sent };
    };
    const a = mk('SoloA');
    const b = mk('SoloB');
    reply('SatuKata');
    const q = 'CHAT GAMES Guess the word: soal solo ai ' + Math.random().toString(36).slice(2, 8);
    a.agent.handleChat(q);
    b.agent.handleChat(q);
    await wait(150);
    check('tepat satu bot menjawab', a.sent.length + b.sent.length === 1, `A=${a.sent.length} B=${b.sent.length}`);
  }

  global.fetch = realFetch;
  console.log(`\n[ai] ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  global.fetch = realFetch;
  console.error('test error:', err);
  process.exit(1);
});
