'use strict';

// Regresi dari log live 2026-10-02: ronde "ketik kode" (xx317Q).
// Yang salah sebelumnya: pesan hadiah masuk ke hafalan, lalu dibalas ulang.
const { createChatGameAgent } = require('../lib/chatgame');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass += 1;
  else fail += 1;
  process.stdout.write(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const realFetch = global.fetch;

function mk(sendSpy) {
  const logs = [];
  const agent = createChatGameAgent({
    config: {
      chatGame: {
        enabled: true, delayMs: 1, minIntervalMs: 0, solo: false, storeFile: null, debugRaw: false,
        api: { enabled: true, endpoint: 'https://ai.test/v1/chat/completions', apiKey: 'k-test' }
      }
    },
    logger: { info: (m) => logs.push(m), warn() {}, success() {}, raw() {} },
    username: 'Uji'
  });
  agent.start({ entity: {}, chat: (m) => sendSpy.push(m) });
  return { agent, logs };
}

// Stub fetch sebelum agent dibuat, supaya jalur AI selalu hidup.
function stubAnswer(text) {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) });
}
stubAnswer('Sunflower');

const HEADER = '  ������ ������ CHAT GAMES ������';
const WINNER = '✔ PakDheIkan tercepat mengetik kodenya (4.0s)';
const REVEAL = '                            Jawaban: xx317Q';
const PRIZE = '  ������ Hadiah sudah dikirim! Cek /chatgames top untuk peringkat.';

(async () => {
  process.stdout.write('[live] satu ronde penuh: header -> pemenang -> jawaban -> hadiah\n');
  {
    const sent = [];
    const { agent } = mk(sent);
    agent.handleChat(HEADER);
    agent.handleChat(WINNER);
    agent.handleChat(REVEAL);
    agent.handleChat(PRIZE);
    await wait(80);
    check('tidak ada jawaban terkirim tanpa soal', sent.length === 0, sent.join('|'));
    check('memory tetap kosong', agent.memory.size === 0, JSON.stringify([...agent.memory.keys()]));
  }

  process.stdout.write('\n[live] hadiah tidak boleh jadi kunci hafalan walau ada "Jawaban:" setelahnya\n');
  {
    const sent = [];
    const { agent } = mk(sent);
    agent.handleChat(PRIZE);          // ronde sebelumnya: hadiah jadi currentRiddle
    agent.handleChat(REVEAL);         // jawaban bocor -> TIDAK BOLEH dihafal ke hadiah
    agent.handleChat(PRIZE);          // ronde berikutnya: hadiah lagi
    await wait(120);
    check('pesan hadiah tidak dihafal', agent.memory.size === 0, JSON.stringify([...agent.memory.entries()]));
    check('tidak ada jawaban basi ke chat', sent.length === 0, sent.join('|'));
  }

  process.stdout.write('\n[live] currentRiddle habis dipakai sekali\n');
  {
    const sent = [];
    const { agent } = mk(sent);
    agent.handleChat('CHAT GAMES Guess the word: kelopak kuning');
    await wait(80);
    check('soal pertama dijawab', sent[0] === 'Sunflower', sent.join('|'));
    agent.handleChat(REVEAL);         //答案 bocor
    agent.handleChat(REVEAL);         // jawaban bocor kedua, tidak boleh memakai soal lama
    await wait(60);
    check('tidak ada kirim tambahan', sent.length === 1, sent.join('|'));
  }

  process.stdout.write('\n[live] soal dari action bar / title (kode tanpa kata "chat games")\n');
  {
    const sent = [];
    const { agent } = mk(sent);
    const r = agent.handleScreen('Ketik kode: xx317Q', 'actionbar');
    await wait(80);
    check('kode dikenali sebagai soal', r && r.type === 'riddle', JSON.stringify(r));

    const sent2 = [];
    const { agent: a2 } = mk(sent2);
    const r2 = a2.handleScreen('xx317Q', 'title:title');
    await wait(80);
    check('kode polos dikenali', r2 && r2.type === 'riddle', JSON.stringify(r2));

    const sent3 = [];
    const { agent: a3 } = mk(sent3);
    a3.handleScreen('Cek /chatgames top untuk peringkat.', 'actionbar');
    await wait(60);
    check('pesan info di action bar diabaikan', sent3.length === 0, sent3.join('|'));
  }

  process.stdout.write('\n[live] jawaban bocor menyambungkan soal action bar ke hafalan\n');
  {
    const sent = [];
    const { agent } = mk(sent);
    agent.handleScreen('xx317Q', 'actionbar');
    await wait(40);
    agent.handleChat(REVEAL);
    await wait(60);
    check('kode dari action bar dihafal', agent.memory.size === 1, JSON.stringify([...agent.memory.entries()]));
    const r = agent.learn('xx317Q', 'xx317Q');
    check('hafal ulang diabaikan karena sama', r === false);
  }

  process.stdout.write('\n[live] karakter rusak tidak masuk ke prompt AI\n');
  {
    let prompt = '';
    global.fetch = async (u, o) => {
      prompt = JSON.parse(o.body).messages[1].content;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) };
    };
    const sent = [];
    const { agent } = mk(sent);
    agent.handleScreen('������������ CHAT GAMES ������ tebak warna pelangi ������', 'actionbar');
    await wait(80);
    check('tidak ada U+FFFD di prompt', !prompt.includes('\uFFFD'), JSON.stringify(prompt));
    check('isi soal tetap ada', /pelangi/.test(prompt), JSON.stringify(prompt));
  }

  global.fetch = realFetch;
  console.log(`\n[live] ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  global.fetch = realFetch;
  console.error('test error:', err);
  process.exit(1);
});
