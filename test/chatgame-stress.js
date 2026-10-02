'use strict';

// Verifikasi jawaban benar dan cepat untuk soal penjumlahan/pengurangan/
// perkalian/pembagian seperti yang dikirim plugin chat-games.
const { createChatGameAgent } = require('../lib/chatgame');
const { formatNumber } = require('../lib/solver');

const silent = { info() {}, warn() {}, success() {}, raw() {} };
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function makeQuestion() {
  const a = rnd(1, 999);
  const b = rnd(1, 99);
  const kind = rnd(0, 6);
  if (kind === 0) return { text: `${a} + ${b} = ?`, want: a + b };
  if (kind === 1) return { text: `${a} - ${b} = ?`, want: a - b };
  if (kind === 2) return { text: `${a} x ${b} = ?`, want: a * b };
  if (kind === 3) return b === 0 ? { text: `${a} + 1 = ?`, want: a + 1 } : { text: `${a} / ${b} = ?`, want: a / b };
  if (kind === 4) {
    const k = rnd(2, 9);
    return { text: `${a} + ${b} * ${k} = ?`, want: a + b * k };
  }
  if (kind === 5) return { text: `Berapa ${a} ditambah ${b}?`, want: a + b };
  return { text: `(${a} + ${b}) x 2 = ?`, want: (a + b) * 2 };
}

function makeAgent(overrides) {
  const agent = createChatGameAgent({
    config: { chatGame: { enabled: true, delayMs: 0, minIntervalMs: 0, solo: false, storeFile: null, mathFirst: true, ...overrides } },
    logger: silent,
    username: 'AzkaSaadi'
  });
  return agent;
}

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass += 1;
  else fail += 1;
  process.stdout.write(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}

(async () => {
  process.stdout.write('[stress] burst: 170 soal, benar semua\n');
  {
    const sent = [];
    const agent = makeAgent({ maxQueue: 1000 });
    agent.start({ entity: {}, chat: (m) => sent.push(m) });
    const expected = [];
    const asked = [];
    for (let i = 0; i < 170; i += 1) {
      const q = makeQuestion();
      expected.push(formatNumber(q.want));
      asked.push(q.text);
      agent.handleChat(`CHAT GAMES ${q.text}`);
    }
    const start = Date.now();
    while (agent.stats.answered < expected.length && Date.now() - start < 15000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    check('semua soal terjawab', sent.length === expected.length, `${sent.length}/${expected.length}`);
    let wrong = 0;
    for (let i = 0; i < Math.min(sent.length, expected.length); i += 1) {
      if (sent[i] !== expected[i]) {
        wrong += 1;
        if (wrong <= 5) console.log(`   salah: "${asked[i]}" -> ${sent[i]} (harusnya ${expected[i]})`);
      }
    }
    check('tidak ada jawaban salah', wrong === 0, `${wrong} salah`);
    check('tidak bergantung pada database', agent.memory.size === 0, `${agent.memory.size} entri`);
    check('AI tidak dipanggil', agent.stats.apiCalls === 0, String(agent.stats.apiCalls));
  }

  process.stdout.write('\n[stress] latency realistis: satu soal satu waktu\n');
  {
    const agent = makeAgent();
    const sent = [];
    agent.start({ entity: {}, chat: (m) => sent.push(m) });
    const worst = [];
    for (let i = 0; i < 40; i += 1) {
      const q = makeQuestion();
      const before = agent.stats.answered;
      agent.handleChat(`CHAT GAMES ${q.text}`);
      const t0 = Date.now();
      while (agent.stats.answered === before && Date.now() - t0 < 3000) {
        await new Promise((r) => setTimeout(r, 5));
      }
      worst.push(Date.now() - t0);
    }
    const max = Math.max(...worst);
    const avg = Math.round(worst.reduce((a, b) => a + b, 0) / worst.length);
    check('40 soal terjawab tepat', sent.length === 40, `${sent.length}/40`);
    check('semua di bawah 1000ms', max < 1000, `paling lambat ${max}ms, rata-rata ${avg}ms`);
    check('biasanya jauh di bawah 100ms', avg < 100, `rata-rata ${avg}ms`);
    console.log(`   latency: rata-rata ${avg}ms, paling lambat ${max}ms, agent ${agent.stats.lastLatencyMs}ms`);
  }

  process.stdout.write('\n[stress] teks non-soal tidak boleh dijawab\n');
  {
    const agent = makeAgent();
    const sent = [];
    agent.start({ entity: {}, chat: (m) => sent.push(m) });

    // Pesan info server asli dari log: tidak boleh dihitung sebagai soal
    for (const info of [
      'hadiah sudah dikirim cek chatgames top untuk peringkat',
      'CHAT GAMES 99 Nulled69 tercepat menghitung (3.0s)',
      '45 + 17 = 62',
      'top 5 pemain',
      'round 3 of 10'
    ]) {
      const before = agent.stats.rounds;
      agent.handleChat(info);
      check(`diabaikan: ${JSON.stringify(info.slice(0, 34))}`, agent.stats.rounds === before, `rounds ${before}->${agent.stats.rounds}`);
    }

    // Bentuk teka-teka kata: boleh jadi soal, tapi tidak boleh dijawab asal
    agent.handleChat('Guess the word: level 10');
    await new Promise((r) => setTimeout(r, 200));
    check('tidak ada yang terkirim', sent.length === 0, JSON.stringify(sent));
    check('teka-teka kata tak dikenal tidak dijawab', agent.stats.misses >= 1, String(agent.stats.misses));
  }

  console.log(`\n[stress] ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
