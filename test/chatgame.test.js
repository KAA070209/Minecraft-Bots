'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createChatGameAgent, normalize, similarity, tokenOverlap, scoreMatch, cleanAnswer } = require('../lib/chatgame');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) passed += 1;
  else failed += 1;
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}

const silent = { info() {}, warn() {}, error() {}, success() {}, raw() {}, debug() {}, plain() {} };
const makeAgent = (overrides = {}, username = 'default') =>
  createChatGameAgent({
    config: { chatGame: { enabled: true, delayMs: 1, minIntervalMs: 0, solo: false, ...overrides } },
    logger: silent,
    username
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  process.stdout.write('[chatgame] normalisasi & kemiripan\n');
  check('normalize buang simbol', normalize('CHAT GAMES: Sunflower!') === 'chat games sunflower', normalize('CHAT GAMES: Sunflower!'));
  check('normalize rapatkan spasi', normalize('  a   b  ') === 'a b');
  check('normalize angka keptik', normalize('level 10') === 'level 10');
  check('normalize emoji dibuang', normalize('✦ Guess the word ✦') === 'guess the word', normalize('✦ Guess the word ✦'));
  check('similarity identik 1', similarity('abc', 'abc') === 1);
  check('similarity beda jauh 0', similarity('abc', 'xyz') === 0);
  check('similarity mirip tinggi', similarity('tebak kata bunga', 'tebak kata bunga!') > 0.9, String(similarity('tebak kata bunga', 'tebak kata bunga!')));
  check('similarity Redemption', similarity('kitten', 'sitting') > 0.571 && similarity('kitten', 'sitting') < 0.572, String(similarity('kitten', 'sitting')));
  check('tokenOverlap identik 1', tokenOverlap('satu dua tiga', 'satu dua tiga') === 1);
  check('tokenOverlap sebagian 1/3', Math.abs(tokenOverlap('satu dua', 'satu tiga') - 1 / 3) < 1e-9, String(tokenOverlap('satu dua', 'satu tiga')));
  check('tokenOverlap tidak ada sama sekali 0', tokenOverlap('satu dua', 'tiga empat') === 0);
  check('scoreMatch pakai yang lebih tinggi', scoreMatch('satu dua', 'satu tiga') === similarity('satu dua', 'satu tiga'), String(scoreMatch('satu dua', 'satu tiga')));
  check('scoreMatchmenghormati max', scoreMatch('a b c d', 'a b e f') === Math.max(similarity('a b c d', 'a b e f'), tokenOverlap('a b c d', 'a b e f')));
  check('cleanAnswer buang tanda baca', cleanAnswer('"Sunflower."', 48) === 'Sunflower', cleanAnswer('"Sunflower."', 48));
  check('cleanAnswer ambil kurung', cleanAnswer('kata (Sunflower)', 48) === 'Sunflower', cleanAnswer('kata (Sunflower)', 48));
  check('cleanAnswer potong panjang', cleanAnswer('x'.repeat(100), 10).length === 10);
  check('cleanAnswer rapikan baris', cleanAnswer('Bunga\nMatahari', 48) === 'Bunga Matahari', cleanAnswer('Bunga\nMatahari', 48));

  process.stdout.write('\n[chatgame] deteksi soal & belajar dari bocoran\n');
  {
    const agent = makeAgent();
    const sent = [];
    agent.start({ entity: {}, chat: (m) => sent.push(m) });
    const riddle = '✦ CHAT GAMES ✦ Guess the word: aku punya kelopak kuning dan beraroma manis';
    check('soal terdeteksi', agent.handleChat(riddle)?.type === 'riddle');
    check('soal baru belum dikenal', agent.lookup(riddle) === null);
    const reveal = agent.handleChat('Jawaban: Sunflower');
    check('baris jawaban terdeteksi', reveal?.type === 'reveal' && reveal.answer === 'Sunflower', JSON.stringify(reveal));
    check('jawaban dihafal dari bocoran', agent.lookup(riddle)?.answer === 'Sunflower', JSON.stringify(agent.lookup(riddle)));
    check('sama persi jadi exact', agent.lookup(riddle)?.source === 'exact');
    check('baris biasa diabaikan', agent.handleChat('Nulled69 berhasil melengkapi katanya (3.5s)') === null);
  }

  process.stdout.write('\n[chatgame] fuzzy match\n');
  {
    const agent = makeAgent({ fuzzyThreshold: 0.7 });
    agent.start({ entity: {}, chat() {} });
    agent.learn('GUESS THE WORD: aku punya kelopak kuning', 'Sunflower');
    const near = agent.lookup('Guess the word: aku punya kelopak kuning dan beraroma manis');
    check('variasi kalimat kena', near && near.answer === 'Sunflower', JSON.stringify(near));
    check('sumber fuzzy', near && near.source === 'fuzzy', near && near.source);
    check('soal beda jauh tidak kena', agent.lookup('tebak warna langit biru') === null);
  }

  process.stdout.write('\n[chatgame] kirim jawaban\n');
  {
    const agent = makeAgent();
    const sent = [];
    agent.start({ entity: {}, chat: (m) => sent.push(m) });
    agent.learn('CHAT GAMES Guess the word: kelopak kuning', 'Sunflower');
    agent.handleChat('CHAT GAMES Guess the word: kelopak kuning');
    await wait(40);
    check('jawaban terkirim ke chat', sent[0] === 'Sunflower', sent.join(','));
    check('stats answered naik', agent.stats.answered === 1, String(agent.stats.answered));
    check('stats rounds naik', agent.stats.rounds === 1, String(agent.stats.rounds));

    const unknown = makeAgent();
    const sent2 = [];
    unknown.start({ entity: {}, chat: (m) => sent2.push(m) });
    unknown.handleChat('CHAT GAMES Guess the word: alat untuk memotong kertas');
    await wait(40);
    check('soal tak dikenal = miss', unknown.stats.misses === 1, String(unknown.stats.misses));
    check('soal tak dikenal tidak dijawab diam-diam', sent2.length === 0, sent2.join(','));
  }

  process.stdout.write('\n[chatgame] status & enable\n');
  {
    const off = createChatGameAgent({ config: { chatGame: { enabled: false } }, logger: silent });
    check('dimatikan -> tidak ada aksi', off.handleChat('CHAT GAMES Guess the word: apa ini') === null);
    const on = makeAgent();
    check('menyala -> jalan', on.handleChat('Chat Games tebak kata: apel')?.type === 'riddle');
    check('teks pendek diabaikan', makeAgent().handleChat('tebak') === null);
  }

  process.stdout.write('\n[chatgame] simpan & muat memory\n');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
    const store = path.join(dir, 'mem.json');
    const a = makeAgent({ storeFile: store });
    a.start({ entity: {}, chat() {} });
    a.learn('soal tersimpan', 'JawabanTersimpan');
    check('file store dibuat', fs.existsSync(store));
    const b = makeAgent({ storeFile: store });
    b.start({ entity: {}, chat() {} });
    check('memory terbaca ulang', b.lookup('soal tersimpan')?.answer === 'JawabanTersimpan',
      JSON.stringify(b.lookup('soal tersimpan')));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  process.stdout.write('\n[chatgame] answersFile\n');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg2-'));
    const file = path.join(dir, 'answers.json');
    fs.writeFileSync(file, JSON.stringify([{ riddle: 'soal dari file', answer: 'DariFile' }]));
    const agent = makeAgent({ answersFile: file });
    agent.start({ entity: {}, chat() {} });
    check('jawaban dari file termuat', agent.lookup('soal dari file')?.answer === 'DariFile',
      JSON.stringify(agent.lookup('soal dari file')));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  process.stdout.write('\n[chatgame] store terpisah per username\n');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg3-'));
    const store = path.join(dir, 'mem-{username}.json');
    const a = makeAgent({ storeFile: store }, 'AzkaSaadi');
    a.start({ entity: {}, chat() {} });
    a.learn('soal Azka', 'JawabAzka');
    const b = makeAgent({ storeFile: store }, 'Lain');
    b.start({ entity: {}, chat() {} });
    check('path memakai username', fs.existsSync(path.join(dir, 'mem-AzkaSaadi.json')),
      fs.readdirSync(dir).join(','));
    check('profil lain tidak menimpa', b.lookup('soal Azka') === null);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  process.stdout.write('\n[chatgame] dedupe: soal sama boleh dijawab ulang setelah jeda\n');
  {
    const agent = makeAgent({ dedupeMs: 40, minIntervalMs: 0 });
    const sent = [];
    agent.start({ entity: {}, chat: (m) => sent.push(m) });
    const riddle = 'CHAT GAMES Guess the word: kelopak kuning';
    agent.learn(riddle, 'Sunflower');
    agent.handleChat(riddle);
    agent.handleChat(riddle);
    agent.handleChat(riddle);
    await wait(30);
    check('duplikat cepat diabaikan', sent.length === 1, sent.join(','));
    check('rounds hanya naik sekali', agent.stats.rounds === 1, String(agent.stats.rounds));
    await wait(60);
    agent.handleChat(riddle);
    await wait(40);
    check('ronde berikutnya tetap dijawab', sent.length === 2, sent.join(','));
    check('rounds naik lagi', agent.stats.rounds === 2, String(agent.stats.rounds));
  }

  process.stdout.write('\n[chatgame] antrean: jawaban tidak terkirim serempak\n');
  {
    const agent = makeAgent({ minIntervalMs: 120, delayMs: 0 });
    const sent = [];
    const at = [];
    const t0 = Date.now();
    const realNow = Date.now;
    agent.start({ entity: {}, chat: (m) => { sent.push(m); at.push(realNow() - t0); } });
    for (let i = 0; i < 4; i += 1) agent.learn(`CHAT GAMES soal antrean ${i}`, `Jawab${i}`);
    for (let i = 0; i < 4; i += 1) agent.handleChat(`CHAT GAMES soal antrean ${i}`);
    await wait(700);
    check('semua jawaban terkirim', sent.length === 4, sent.join(','));
    check('urutan terjaga', sent.join(',') === 'Jawab0,Jawab1,Jawab2,Jawab3', sent.join(','));
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    check('jarak antar jawaban >= minIntervalMs', gaps.every((g) => g >= 100), JSON.stringify(gaps));
    check('tidak serempak', new Set(at).size > 1, JSON.stringify(at));
  }

  process.stdout.write('\n[chatgame] solo: satu bot menjawab per soal\n');
  {
    const a = makeAgent({ solo: true, soloWindowMs: 5000 }, 'BotA');
    const b = makeAgent({ solo: true, soloWindowMs: 5000 }, 'BotB');
    const sentA = [];
    const sentB = [];
    a.start({ entity: {}, chat: (m) => sentA.push(m) });
    b.start({ entity: {}, chat: (m) => sentB.push(m) });
    const q = 'CHAT GAMES Guess the word: soal solo untuk pengujian';
    a.learn(q, 'SoloJawaban');
    b.learn(q, 'SoloJawaban');
    a.handleChat(q);
    b.handleChat(q);
    await wait(60);
    check('hanya satu bot yang menjawab', sentA.length + sentB.length === 1, `A=${sentA.length} B=${sentB.length}`);
    check('bot yang pertama kirim', sentA.length === 1 && sentA[0] === 'SoloJawaban', sentA.join(','));

    const c = makeAgent({ solo: false }, 'BotC');
    const d = makeAgent({ solo: false }, 'BotD');
    const sentC = [];
    const sentD = [];
    c.start({ entity: {}, chat: (m) => sentC.push(m) });
    d.start({ entity: {}, chat: (m) => sentD.push(m) });
    c.learn(q, 'SoloJawaban');
    d.learn(q, 'SoloJawaban');
    c.handleChat(q);
    d.handleChat(q);
    await wait(60);
    check('solo:false -> semua bot menjawab', sentC.length === 1 && sentD.length === 1, `C=${sentC.length} D=${sentD.length}`);
  }

  process.stdout.write('\n[chatgame] header tanpa soal tidak boleh jadi memory\n');
  {
    const agent = makeAgent();
    agent.start({ entity: {}, chat() {} });
    // Regresi: header "CHAT GAMES" pernah dihafal -> "85", lalu bot menjawab 85 untuk semua soal
    const result = agent.handleChat('CHAT GAMES');
    check('header saja bukan soal', result === null, JSON.stringify(result));
    agent.handleChat('Jawaban: 85');
    check('tidak ada memory dari header', agent.memory.size === 0, JSON.stringify([...agent.memory]));
    check('tidak ada rounds terhitung', agent.stats.rounds === 0, String(agent.stats.rounds));
    agent.handleChat('CHAT GAMES 12 + 30 = ?');
    await wait(30);
    check('memory tetap kosong setelah soal asli', agent.memory.size === 0, String(agent.memory.size));
  }

  process.stdout.write('\n[chatgame] isInformative\n');
  {
    const { isInformative } = require('../lib/chatgame');
    const s = { patterns: { detect: '(chat\\s*games?|tebak|guess|riddle)' }, minResidueChars: 6 };
    check('header chat games tidak informatif', isInformative('CHAT GAMES', s) === false);
    check('header dekoratif tidak informatif', isInformative('=== CHAT GAMES ===', s) === false);
    check('soal angka informatif', isInformative('CHAT GAMES 12 + 30', s) === true);
    check('soal kata panjang informatif', isInformative('CHAT GAMES Guess the word: kelopak kuning', s) === true);
    check('kata pendek tidak informatif', isInformative('tebak apa', s) === false);
  }

  process.stdout.write('\n[chatgame] solver matematika sebagai jalur utama\n');
  {
    const agent = makeAgent();
    const sent = [];
    agent.start({ entity: {}, chat: (m) => sent.push(m) });
    const res = agent.handleChat('CHAT GAMES 12 + 30 = ?');
    await wait(30);
    check('soal matematika dijawab', sent[0] === '42', sent.join(','));
    check('sumber jawaban bukan AI/memory', agent.stats.apiCalls === 0 && agent.stats.misses === 0, JSON.stringify(agent.stats));
    check('latency < 1000ms', agent.stats.lastLatencyMs < 1000, agent.stats.lastLatencyMs + 'ms');
    check('tidak pakai AI', agent.stats.apiCalls === 0, String(agent.stats.apiCalls));
    check('tidak perlu memory', agent.memory.size === 0, String(agent.memory.size));
  }

  process.stdout.write('\n[chatgame] ekstraksi teks dari JSON mentah + hover\n');
  {
    const { extractChatText } = require('../lib/chatgame');
    const flat = extractChatText('halo');
    check('string biasa', flat === 'halo', flat);
    const nested = extractChatText({ text: '', extra: [{ text: 'a' }, { text: 'b' }] });
    check('extra digabung', nested === 'ab', nested);
    const withHover = extractChatText({
      text: 'CHAT GAMES',
      hoverEvent: { action: 'show_text', value: { contents: { text: '12 + 30 = ?' } } }
    });
    check('hover diekstrak', withHover.includes('12 + 30 = ?'), withHover);
    const clickable = extractChatText({
      text: '[Klik] ',
      extra: [{
        text: 'CHAT GAMES 8 * 7 = ?',
        hoverEvent: { value: { contents: { translate: 'x' } } }
      }]
    });
    check('gabungan text+extra', clickable.includes('8 * 7 = ?'), clickable);
    check('null aman', extractChatText(null) === '');

    const agent = makeAgent();
    const sent = [];
    agent.start({ entity: {}, chat: (m) => sent.push(m) });
    agent.handleJson({ text: '', hoverEvent: { value: { contents: { text: 'CHAT GAMES 8 * 7 = ?' } } } });
    await wait(30);
    check('soal dari hover langsung dijawab', sent[0] === '56', sent.join(','));
  }

  process.stdout.write('\n[chatgame] antrean dibersihkan saat stop\n');
  {
    const agent = makeAgent({ minIntervalMs: 400 });
    const sent = [];
    agent.start({ entity: {}, chat: (m) => sent.push(m) });
    agent.learn('CHAT GAMES soal stop 1', 'S1');
    agent.learn('CHAT GAMES soal stop 2', 'S2');
    agent.handleChat('CHAT GAMES soal stop 1');
    agent.handleChat('CHAT GAMES soal stop 2');
    agent.stop();
    await wait(500);
    check('tidak ada yang terkirim setelah stop', sent.length === 0, sent.join(','));

    const agent2 = makeAgent({ minIntervalMs: 0 });
    const sent2 = [];
    agent2.start({ entity: {}, chat: (m) => sent2.push(m) });
    agent2.learn('CHAT GAMES soal stop 3', 'S3');
    agent2.handleChat('CHAT GAMES soal stop 3');
    await wait(40);
    check('kontrol: tanpa stop jawaban terkirim', sent2.length === 1, sent2.join(','));
  }

  process.stdout.write('\n[chatgame] tidak crash saat bot belum ada\n');
  {
    const agent = makeAgent();
    agent.handleChat('CHAT GAMES Guess the word: tanpa bot');
    await wait(40);
    check('tidak melempar error', agent.stats.answered === 0);
  }

  console.log(`\n[chatgame] ${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('chatgame test error:', err);
  process.exit(1);
});
