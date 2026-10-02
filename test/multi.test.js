'use strict';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { loadConfig } = require('../lib/config');
const { createLogger } = require('../lib/logger');
const { createRunner } = require('../lib/runner');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.TEST_PORT || '25569';
const EXPECTED = ['jack01', 'jack02', 'jack03', 'jack04', 'jack05', 'jack06', 'jack07', 'jack08'];

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) passed += 1;
  else failed += 1;
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-multi-'));
const profilesFile = path.join(tmpDir, 'profiles.json');
const logsDir = path.join(tmpDir, 'logs');

fs.writeFileSync(profilesFile, JSON.stringify({
  defaults: {
    server: { host: '127.0.0.1', port: Number(PORT) },
    version: '1.16',
    register: { enabled: true, mode: 'auto', delayMs: 600, retryMs: 1500, maxAttempts: 4 },
    afk: { mode: 'safe', minIntervalMs: 1200, maxIntervalMs: 2200 },
    logging: { level: 'info', file: path.join(logsDir, '{name}.log'), logChat: false },
    console: { enabled: false }
  },
  profiles: EXPECTED.map((name) => ({ name }))
}, null, 2));

let server = null;
let multi = null;
let serverOut = '';
let multiOut = '';

function cleanup() {
  if (multi && multi.exitCode === null) multi.kill('SIGKILL');
  if (server && server.exitCode === null) server.kill('SIGKILL');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

(async () => {
  process.stdout.write('[multi] menyalakan server test lokal...\n');
  server = spawn(process.execPath, [path.join(__dirname, 'local-server.js')], {
    cwd: ROOT,
    env: { ...process.env, TEST_PORT: PORT, TEST_KICK_AFTER: '0', TEST_REQUIRE_AUTH: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (d) => { serverOut += d.toString(); });
  server.stderr.on('data', (d) => { serverOut += d.toString(); });
  server.on('error', (err) => {
    console.error('[multi] server gagal start:', err.message);
    cleanup();
    process.exit(1);
  });
  await new Promise((r) => setTimeout(r, 2000));

  const bootStart = Date.now();
  process.stdout.write(`[multi] menjalankan ${EXPECTED.length} profil dalam satu proses...\n`);
  multi = spawn(process.execPath, [
    path.join(ROOT, 'multi.js'),
    '--profiles', profilesFile,
    '--stagger', '700',
    '--statusEvery', '5000'
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  multi.stdout.on('data', (d) => { multiOut += d.toString(); });
  multi.stderr.on('data', (d) => { multiOut += d.toString(); });

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (/8\/8 online/.test(multiOut) && /8 terautentikasi/.test(multiOut)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const readyMs = Date.now() - bootStart;

  const joinNames = [...serverOut.matchAll(/username=(jack\d+)/g)].map((m) => m[1]);
  const uniqueJoins = new Set(joinNames);
  const spawnLines = multiOut.split(/\r?\n/).filter((l) => /spawn di/.test(l));
  const loginLines = multiOut.split(/\r?\n/).filter((l) => /login berhasil/.test(l));

  check(`8/8 bot online dalam ${(readyMs / 1000).toFixed(1)}s`, /8\/8 online/.test(multiOut),
    (multiOut.match(/\d+\/8 online/g) || ['tidak ada baris status']).slice(-1)[0]);
  check('satu proses untuk semua bot', /memuat 8 profil/.test(multiOut));
  check(`server melihat ${EXPECTED.length} nama berbeda`, uniqueJoins.size === EXPECTED.length,
    [...uniqueJoins].sort().join(','));
  check('semua nama jack01-jack08 muncul', EXPECTED.every((n) => uniqueJoins.has(n)));
  check('tidak ada nama tak terduga', joinNames.every((n) => /^jack0[1-8]$/.test(n)),
    [...new Set(joinNames.filter((n) => !/^jack0[1-8]$/.test(n)))].join(',') || 'bersih');
  check(`semua ${EXPECTED.length} bot login`, loginLines.length >= EXPECTED.length, `auth=${loginLines.length}`);
  check(`semua ${EXPECTED.length} bot spawn`, spawnLines.length >= EXPECTED.length, `spawn=${spawnLines.length}`);
  check(`semua ${EXPECTED.length} bot auto-register`, /8 terautentikasi/.test(multiOut),
    (multiOut.match(/\d+ terautentikasi/g) || ['tidak ada']).slice(-1)[0]);
  EXPECTED.forEach((name) => {
    check(`${name} terdaftar di server`, new RegExp(`\\[test-server\\] registered ${name}`).test(serverOut));
    check(`${name} registers sendiri (ada di log)`, /auto-register \(\d+x\)/.test(
      multiOut.split('\n').filter((l) => l.includes(`[${name}]`)).join('\n')
    ));
  });
  check('server melihat 8 /register berbeda',
    new Set([...serverOut.matchAll(/chat (jack\d+): \/register \1/g)].map((m) => m[1])).size === EXPECTED.length);
  check('prefix nama ada di setiap baris log', EXPECTED.every((n) => new RegExp(`\\[${n}\\]`).test(multiOut)));
  check('tanpa Microsoft / device code', !/device code|microsoft\.com\/link|Microsoft login|mengambil token/i.test(multiOut));
  check('tanpa error runtime', !/uncaught|unhandled rejection|\[ERROR\]|ECONNREFUSED/i.test(multiOut),
    (multiOut.match(/(uncaught|unhandled|ERROR|ECONNREFUSED)[^\n]*/) || [''])[0]);
  check('tabel status menampilkan 8 bot', /jack01\s+online/.test(multiOut) && /jack08\s+online/.test(multiOut));

  const logFiles = fs.existsSync(logsDir) ? fs.readdirSync(logsDir).filter((f) => /^jack\d\d\.log$/.test(f)) : [];
  check(`log terpisah per bot (${EXPECTED.length} file)`, logFiles.length === EXPECTED.length, logFiles.join(','));
  if (logFiles.length) {
    const sample = fs.readFileSync(path.join(logsDir, logFiles[0]), 'utf8');
    check('isi log per bot berisi spawn', /spawn di/.test(sample), logFiles[0]);
  }

  process.stdout.write('\n[multi] tes --only (jalan sebagian profil)...\n');
  serverOut = '';
  const onlyNames = ['jack01', 'jack05'];
  const only = spawn(process.execPath, [
    path.join(ROOT, 'multi.js'),
    '--profiles', profilesFile,
    '--only', onlyNames.join(','),
    '--stagger', '500',
    '--statusEvery', '5000'
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let onlyOut = '';
  only.stdout.on('data', (d) => { onlyOut += d.toString(); });
  only.stderr.on('data', (d) => { onlyOut += d.toString(); });

  const onlyDeadline = Date.now() + 40000;
  while (Date.now() < onlyDeadline) {
    if (/\/2 online/.test(onlyOut)) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const onlyJoined = new Set([...serverOut.matchAll(/username=(jack\d+)/g)].map((m) => m[1]));
  check('--only: hanya profil terpilih yang dimuat', /memuat 2 profil/.test(onlyOut),
    (onlyOut.match(/memuat \d+ profil[^|]*/) || ['tidak ada baris muat'])[0]);
  check('--only: jumlah profil lain disebut sebagai dilewati', /lewati 6 profil/.test(onlyOut),
    (onlyOut.match(/lewati \d+ profil[^\n]*/) || ['tidak ada baris lewati'])[0]);
  check('--only: kedua profil terpilih join', onlyNames.every((n) => onlyJoined.has(n)), [...onlyJoined].join(','));
  check('--only: tidak ada profil lain yang join', onlyJoined.size === onlyNames.length, [...onlyJoined].join(','));
  check('--only: bot terpilih online', /2\/2 online/.test(onlyOut), (onlyOut.match(/\d+\/\d+ online/g) || ['-']).slice(-1)[0]);
  only.kill('SIGINT');
  await Promise.race([
    new Promise((r) => only.once('exit', r)),
    new Promise((r) => setTimeout(r, 15000))
  ]);

  process.stdout.write('\n[multi] tes --only dengan nama yang tidak ada...\n');
  const bad = spawn(process.execPath, [
    path.join(ROOT, 'multi.js'),
    '--profiles', profilesFile,
    '--only', 'jack01,tidakada'
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let badOut = '';
  bad.stdout.on('data', (d) => { badOut += d.toString(); });
  bad.stderr.on('data', (d) => { badOut += d.toString(); });
  const badExit = await Promise.race([
    new Promise((r) => bad.once('exit', (code) => r(code))),
    new Promise((r) => setTimeout(() => r(null), 15000))
  ]);
  check('--only: nama salah ditolak', badExit === 1, `exit=${badExit}`);
  check('--only: nama salah memberi daftar nama tersedia', /yang tersedia:/.test(badOut), badOut.split('\n')[0] || '');

  process.stdout.write('\n[multi] tes proses berhenti...\n');
  multi.kill('SIGINT');
  const exited = await Promise.race([
    new Promise((r) => multi.once('exit', (code, signal) => r({ code, signal }))),
    new Promise((r) => setTimeout(() => r(null), 15000))
  ]);
  check('proses berhenti setelah SIGINT', exited !== null, `exit=${exited ? `code=${exited.code} signal=${exited.signal}` : 'timeout'}`);

  process.stdout.write('\n[multi] tes shutdown bersih via API runner (independen dari sinyal)...\n');
  const apiOut = [];
  const apiBase = {
    server: { host: '127.0.0.1', port: Number(PORT) },
    version: '1.16',
    afk: { mode: 'look', minIntervalMs: 5000, maxIntervalMs: 8000 },
    register: { enabled: false, mode: 'off' },
    join: { spawnTimeoutMs: 20000, autoReconnect: false },
    reconnect: { autoReconnect: false, baseMs: 1000, maxMs: 2000, factor: 2, jitter: 0, maxAttempts: 0, afkKickExtraMs: 0 },
    logging: { level: 'silent', file: null, color: false, logChat: false },
    console: { enabled: false },
    survival: { autoEat: true, eatBelowFood: 18, eatBelowHealth: 17, rescue: true, lowHealthQuit: 0 }
  };
  const runners = ['apiOne', 'apiTwo'].map((name) => {
    const config = loadConfig([], {
      MC_CONFIG_JSON: JSON.stringify({
        ...apiBase,
        join: { spawnTimeoutMs: 20000, autoReconnect: true },
        reconnect: { baseMs: 1000, maxMs: 2000, factor: 2, jitter: 0, maxAttempts: 0, afkKickExtraMs: 0 },
        account: { username: name }
      })
    });
    return createRunner({
      config,
      logger: createLogger({ file: null, color: false, level: 'silent' }),
      onStateChange: (state, status) => apiOut.push(`${name}:${status}`)
    });
  });
  runners.forEach((r) => r.connect());

  const spawnDeadline = Date.now() + 25000;
  while (Date.now() < spawnDeadline && runners.some((r) => r.state.status !== 'online')) {
    await new Promise((r) => setTimeout(r, 300));
  }
  check('kedua runner API mencapai status online', runners.every((r) => r.state.status === 'online'),
    runners.map((r) => `${r.label}=${r.state.status}`).join(','));

  const shutdownStart = Date.now();
  await Promise.all(runners.map((r) => r.shutdown('tes shutdown')));
  const shutdownMs = Date.now() - shutdownStart;

  check(`shutdown()resolve untuk semua runner (${shutdownMs}ms)`, runners.every((r) => r.state.status === 'stopped'),
    runners.map((r) => `${r.label}=${r.state.status}`).join(','));
  check('bot dilepas (tidak ada koneksi tertinggal)', runners.every((r) => r.bot === null));
  check('tidak ada state connecting/online tersisa', runners.every((r) => !['connecting', 'online'].includes(r.state.status)),
    runners.map((r) => r.state.status).join(','));
  check('urutan state shutdown benar', runners.every((r) => {
    const own = apiOut.filter((s) => s.startsWith(`${r.label}:`)).map((s) => s.split(':')[1]);
    return own.includes('online') && own.includes('stopping') && own[own.length - 1] === 'stopped';
  }), apiOut.join(' '));

  if (failed) {
    process.stdout.write('\n--- serverOut ---\n' + serverOut.split(/\r?\n/).slice(-25).join('\n'));
    process.stdout.write('\n--- multiOut (60 baris terakhir) ---\n' + multiOut.split(/\r?\n/).slice(-60).join('\n'));
  }

  process.stdout.write(`\n[multi] ${passed}/${passed + failed} passed\n`);
  cleanup();
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('[multi] error:', err);
  cleanup();
  process.exit(1);
});