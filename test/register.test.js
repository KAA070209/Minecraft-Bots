'use strict';

const {
  createState,
  nextStep,
  applyChat,
  classifyChat,
  resolvePassword,
  maskSecret
} = require('../lib/register');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) passed += 1;
  else failed += 1;
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}

function config(overrides = {}) {
  return {
    account: { username: 'jack01' },
    register: { enabled: true, mode: 'auto', password: null, delayMs: 0, retryMs: 0, maxAttempts: 3, ...overrides }
  };
}

process.stdout.write('[register] classifyChat\n');
check('pesan "not registered" terdeteksi', classifyChat('You are not registered. Please register first.') === 'not-registered');
check('pesan "belum terdaftar" terdeteksi', classifyChat('Kamu belum terdaftar di server ini') === 'not-registered');
check('pesan registered terdeteksi', classifyChat('Successfully registered!') === 'registered');
check('pesan welcome back terdeteksi', classifyChat('Welcome back! You are now logged in.') === 'logged-in');
check('pesan welcome back saja terdeteksi', classifyChat('Welcome back') === 'logged-in');
check('pesan registered salah urutan priority', classifyChat('Wrong password! Registered players use /login') === 'login-failed');
check('chat biasa diabaikan', classifyChat('jack01 joined the game') === null);
check('chat kosong diabaikan', classifyChat('') === null);
check('chat null diabaikan', classifyChat(null) === null);

process.stdout.write('\n[register] resolvePassword\n');
check('password null memakai username', resolvePassword(config(), 'jack01') === 'jack01');
check('password dari config dipakai', resolvePassword(config({ password: 'rahasia' }), 'jack01') === 'rahasia');
check('password kosong-string jatuh ke username', resolvePassword(config({ password: '' }), 'jack07') === 'jack07');
check('password angka jadi string', resolvePassword(config({ password: 12345 }), 'jack01') === '12345');

process.stdout.write('\n[register] mode auto\n');
{
  const state = createState();
  const cfg = config();
  const first = nextStep(state, cfg, 1000);
  check('langkah pertama = login', first && first.type === 'login', first && first.command);
  check('format /login benar', first && first.command === '/login jack01', first && first.command);

  applyChat(state, 'You are not registered. Please register first.');
  const second = nextStep(state, cfg, 2000);
  check('setelah "not registered" = register', second && second.type === 'register', second && second.command);
  check('format /register benar', second && second.command === '/register jack01 jack01', second && second.command);

  applyChat(state, 'Successfully registered!');
  check('setelah registered = authenticated', state.authenticated === true);
  check('tidak ada aksi setelah authenticated', nextStep(state, cfg, 3000) === null);
}

process.stdout.write('\n[register] retry & batas attempt\n');
{
  const state = createState();
  const cfg = config({ maxAttempts: 2 });
  check('attempt 1 login', nextStep(state, cfg, 1000)?.type === 'login');
  check('attempt 2 login ulang (server belum jawab)', nextStep(state, cfg, 2000)?.type === 'login');
  check('attempt habis = berhenti', nextStep(state, cfg, 3000) === null);
  check('total attempt = maxAttempts', state.attempts === 2, `attempts=${state.attempts}`);
}

process.stdout.write('\n[register] cooldown\n');
{
  const state = createState();
  state.startedAt = 1000;
  const cfg = config({ delayMs: 1500, retryMs: 6000 });
  check('belum sampai delayMs = tidak ada aksi', nextStep(state, cfg, 1600) === null);
  const a = nextStep(state, cfg, 2600);
  check('setelah delayMs = login', a?.type === 'login');
  check('retryMs menahan aksi berikutnya', nextStep(state, cfg, 3000) === null);
  check('setelah retryMs = login lagi', nextStep(state, cfg, 9000)?.type === 'login');
}

process.stdout.write('\n[register] delayMs diukur dari mulai join\n');
{
  const state = createState();
  check('startedAt 0 tidak memblokir (dipakai manual)', nextStep(state, config({ delayMs: 5000 }), 1000)?.type === 'login');
  const s2 = createState();
  s2.startedAt = 100000;
  check('startedAt baru menahan sesuai delayMs', nextStep(s2, config({ delayMs: 5000 }), 101000) === null);
  check('setelah delayMs dari startedAt boleh', nextStep(s2, config({ delayMs: 5000 }), 106000)?.type === 'login');
}

process.stdout.write('\n[register] mode register & login & off\n');
{
  const s1 = createState();
  const a = nextStep(s1, config({ mode: 'register' }), 1000);
  check('mode register langsung /register', a?.type === 'register' && a.command === '/register jack01 jack01', a && a.command);
  check('mode register tidak pernah /login', nextStep(s1, config({ mode: 'register' }), 2000) === null);

  const s2 = createState();
  const b = nextStep(s2, config({ mode: 'login' }), 1000);
  check('mode login hanya /login', b?.type === 'login');
  applyChat(s2, 'You are not registered');
  check('mode login tidak fallback ke register', nextStep(s2, config({ mode: 'login' }), 2000) === null);

  const s3 = createState();
  check('mode off tidak ada aksi', nextStep(s3, config({ mode: 'off' }), 5000) === null);

  const s4 = createState();
  check('enabled false tidak ada aksi', nextStep(s4, config({ enabled: false }), 5000) === null);
}

process.stdout.write('\n[register] password eksplisit dipakai di kedua perintah\n');
{
  const state = createState();
  const cfg = config({ password: 'botsecret' });
  const login = nextStep(state, cfg, 1000);
  const reg = (() => { applyChat(state, 'not registered'); return nextStep(state, cfg, 2000); })();
  check('/login pakai password config', login.command === '/login botsecret', login.command);
  check('/register pakai password config', reg.command === '/register botsecret botsecret', reg.command);
}

process.stdout.write('\n[register] login gagal memicu register\n');
{
  const state = createState();
  const cfg = config();
  nextStep(state, cfg, 1000);
  applyChat(state, 'Wrong password!');
  check('wrong password = notRegistered', state.notRegistered === true);
  const next = nextStep(state, cfg, 2000);
  check('lalu coba register', next?.type === 'register', next && next.command);
}

process.stdout.write('\n[register] "already registered" fallback ke login\n');
{
  check('pesan already registered terdeteksi', classifyChat('That name is already registered.') === 'already-registered');
  check('priority di atas "registered"', classifyChat('That name is already registered.') !== 'registered');

  const s = createState();
  const cfg = config({ mode: 'register' });
  check('mode register attempt pertama register', nextStep(s, cfg, 1000)?.type === 'register');
  applyChat(s, 'That name is already registered.');
  check('flag alreadyRegistered terpasang', s.alreadyRegistered === true);
  const pivot = nextStep(s, cfg, 2000);
  check('pivot ke /login setelah already registered', pivot?.type === 'login', pivot && pivot.command);
  check('tidak register ulang', s.triedRegister === true);

  const s2 = createState();
  const cfg2 = config({ mode: 'auto' });
  nextStep(s2, cfg2, 1000);
  applyChat(s2, 'That name is already registered.');
  check('auto mode juga pivot ke /login', nextStep(s2, cfg2, 2000)?.type === 'login');
}

console.log('\n[register] masking password');
check('login 1 kata tidak bocor', maskSecret('/login rahasia123', 'rahasia123') === '/login <password>', maskSecret('/login rahasia123', 'rahasia123'));
check('register 2 kata tidak bocor', maskSecret('/register rahasia123 rahasia123', 'rahasia123') === '/register <password> <password>', maskSecret('/register rahasia123 rahasia123', 'rahasia123'));
check('mask semua kemunculan', maskSecret('/login a a', 'a') === '/login <password> <password>');
check('password kosong tidak pecah', maskSecret('/login x', '') === '/login x');
check('secret tidak cocok -> teks tetap', maskSecret('/login xyzzy', 'lain') === '/login xyzzy');
check('tidak ada string asli tersisa', !maskSecret('/login rahasia123', 'rahasia123').includes('rahasia123'));

console.log(`\n[register] ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);