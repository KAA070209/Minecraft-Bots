'use strict';

const { createChatGameAgent } = require('../lib/chatgame');

const silent = { info() {}, warn() {}, success() {}, raw() {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function agentFor(overrides = {}) {
  const agent = createChatGameAgent({
    config: { chatGame: { enabled: true, delayMs: 10, minIntervalMs: 0, solo: false, storeFile: null, ...overrides } },
    logger: silent,
    username: 'AzkaSaadi'
  });
  return agent;
}

(async () => {
  let pass = 0;
  let fail = 0;
  const check = (name, cond, detail = '') => {
    if (cond) pass += 1;
    else fail += 1;
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  };

  const sent = [];
  const agent = agentFor();
  agent.start({ entity: {}, chat: (m) => { sent.push(m); console.log(`   >> chat: ${m}`); } });

  console.log('\n[1] Ronde dari log asli: hanya header terlihat, soal tidak');
  agent.handleChat('           ������ ������ CHAT GAMES ������');
  agent.handleChat('');
  agent.handleChat('        ✔ Nulled69 tercepat menghitung (3.0s)');
  agent.handleChat('                                  Jawaban: 85');
  await wait(40);
  check('tidak ada jawaban terkirim', sent.length === 0, JSON.stringify(sent));
  check('tidak ada memory diracuni', agent.memory.size === 0, JSON.stringify([...agent.memory]));
  check('rounds tetap 0', agent.stats.rounds === 0, String(agent.stats.rounds));

  console.log('\n[2] Ronde berikutnya, soal(math) terlihat utuh');
  agent.handleChat('CHAT GAMES 45 + 17 = ?');
  await wait(40);
  check('dijawab 62 tanpa AI', sent[0] === '62', JSON.stringify(sent));
  check('latency < 1000ms', agent.stats.lastLatencyMs < 1000, agent.stats.lastLatencyMs + 'ms');
  check('AI tidak dipanggil', agent.stats.apiCalls === 0, String(agent.stats.apiCalls));

  console.log('\n[3] Soal beda di ronde berikutnya');
  agent.handleChat('CHAT GAMES 100 / 4 = ?');
  await wait(40);
  check('dijawab 25', sent[1] === '25', JSON.stringify(sent));

  console.log('\n[4] Teks soal tersembunyi di hoverEvent');
  agent.handleJson({ text: '', hoverEvent: { action: 'show_text', value: { contents: { text: 'CHAT GAMES 8 * 7 = ?' } } } });
  await wait(40);
  check('dijawab 56 dari hover', sent[2] === '56', JSON.stringify(sent));

  console.log('\n[5] Kata yang mengandung angka tidak disalahartikan sebagai soal hitung');
  const before = sent.length;
  agent.handleChat('CHAT GAMES Guess the word: level 10 bounty');
  await wait(40);
  check('tidak dijawab asal', sent.length === before, JSON.stringify(sent.slice(before)));

  console.log(`\n[regresi] ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
