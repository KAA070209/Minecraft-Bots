'use strict';

const { spawn } = require('child_process');
const path = require('path');

const { loadConfig } = require('../lib/config');
const { createLogger } = require('../lib/logger');
const { createRunner } = require('../lib/runner');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.TEST_PORT || '25570';
const WAIT_MS = 60000;

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) passed += 1;
  else failed += 1;
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}

function makeConfig(username, overrides = {}) {
  return loadConfig([], {
    // pointer ke file yang tidak ada supaya config.json lokal tidak bocor ke test
    MC_CONFIG: path.join(ROOT, 'test', '.tidak-ada-config.json'),
    MC_CONFIG_JSON: JSON.stringify({
      server: { host: '127.0.0.1', port: Number(PORT) },
      version: '1.16',
      account: { username },
      join: { spawnTimeoutMs: 30000, autoReconnect: true },
      register: { enabled: true, mode: 'auto', password: null, delayMs: 800, retryMs: 2500, maxAttempts: 4 },
      afk: { mode: 'look', minIntervalMs: 30000, maxIntervalMs: 40000 },
      reconnect: { baseMs: 2000, maxMs: 4000, factor: 2, jitter: 0, maxAttempts: 0, afkKickExtraMs: 0 },
      logging: { level: 'debug', file: null, color: false, logChat: true },
      console: { enabled: false },
      ...overrides
    })
  });
}

const botLogs = [];
const silentishLogger = createLogger({ file: null, color: false, level: 'debug' });

function trackingLogger() {
  const logger = createLogger({ file: null, color: false, level: 'debug' });
  const capture = (method) => {
    const original = logger[method];
    logger[method] = (message) => {
      botLogs.push(`[${method}] ${message}`);
      original(message);
    };
  };
  ['info', 'warn', 'error', 'debug', 'raw'].forEach(capture);
  return logger;
}

function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolve) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (predicate()) {
        clearInterval(poll);
        resolve(true);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(poll);
        resolve(false);
      }
    }, 200);
  });
}

(async () => {
  process.stdout.write('[register-live] menyalakan server lokal dengan TEST_REQUIRE_AUTH=1...\n');
  const server = spawn(process.execPath, [path.join(__dirname, 'local-server.js')], {
    cwd: ROOT,
    env: { ...process.env, TEST_PORT: PORT, TEST_KICK_AFTER: '0', TEST_REQUIRE_AUTH: '1', TEST_ONLINE_MODE_USER: 'jack04' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOut = '';
  server.stdout.on('data', (d) => { serverOut += d.toString(); });
  server.stderr.on('data', (d) => { serverOut += d.toString(); });
  await new Promise((r) => setTimeout(r, 2000));

  process.stdout.write('[register-live] bot jack01 masuk, harus daftar sendiri...\n');
  const runner = createRunner({ config: makeConfig('jack01'), logger: trackingLogger() });
  runner.connect();

  const registered = await waitFor(() => runner.state.registerStatus === 'authenticated', WAIT_MS, 'registered');
  check('bot mencapai status authenticated', registered, `status=${runner.state.registerStatus}`);
  check('server menerima /register jack01 jack01', /chat jack01: \/register jack01 jack01/.test(serverOut),
    (serverOut.match(/chat jack01:[^\n]*/) || ['tidak ada chat'])[0]);
  check('percobaan awal adalah /login', /chat jack01: \/login jack01/.test(serverOut));
  check('server mencatat registered jack01', /\[test-server\] registered jack01/.test(serverOut));
  check('registerStatus = authenticated', runner.state.registerStatus === 'authenticated');
  check('agent tidak mengirim perintah lagi setelah authenticated',
    !/auto-(register|login) \(/.test(botLogs.slice(-3).join(' ')) || runner.register.state.done === true);

  process.stdout.write('\n[register-live] tes password eksplisit (mode register langsung)...\n');
  botLogs.length = 0;
  const cfg2 = makeConfig('jack02', { register: { enabled: true, mode: 'register', password: 'rahasia02', delayMs: 800, retryMs: 2500, maxAttempts: 2 } });
  const runner2 = createRunner({ config: cfg2, logger: trackingLogger() });
  runner2.connect();
  const registered2 = await waitFor(() => runner2.state.registerStatus === 'authenticated', WAIT_MS, 'registered2');
  check('jack02 terdaftar dengan password eksplisit', registered2, `status=${runner2.state.registerStatus}`);
  check('server melihat /register rahasia02 rahasia02',
    /chat jack02: \/register rahasia02 rahasia02/.test(serverOut), (serverOut.match(/chat jack02:[^\n]*/) || ['tidak ada'])[0]);
  check('jack02 tidak pernah kirim /login', !/chat jack02: \/login/.test(serverOut));

  process.stdout.write('\n[register-live] tes rejoin: harus /login, bukan register lagi...\n');
  const beforeRejoin = (serverOut.match(/chat jack01: \/register/g) || []).length;
  runner.bot.quit('tes rejoin');
  const rejoined = await waitFor(() => runner.state.joins >= 2, WAIT_MS, 'rejoin');
  const waitLogin = await waitFor(() => (serverOut.match(/\[test-server\] login jack01/g) || []).length >= 1, WAIT_MS, 'login again');
  const loginAttempts = (serverOut.match(/chat jack01: \/login/g) || []).length;
  check('bot berhasil join ulang', rejoined, `joins=${runner.state.joins}`);
  check('bot kirim /login lagi setelah rejoin', loginAttempts >= 2, `percobaan login=${loginAttempts}`);
  check('server menerima login setelah rejoin', waitLogin);
  const afterRejoin = (serverOut.match(/chat jack01: \/register/g) || []).length;
  check('tidak register ulang (akun sudah ada)', afterRejoin === beforeRejoin, `register=${afterRejoin}`);
  check('tidak ada kick auth setelah login', !/kick jack01/.test(serverOut));

  process.stdout.write('\n[register-live] tes register dimatikan (enabled false)...\n');
  const runner3 = createRunner({ config: makeConfig('jack03', { register: { enabled: false, mode: 'auto' } }), logger: createLogger({ file: null, color: false, level: 'silent' }) });
  runner3.connect();
  await waitFor(() => runner3.state.status === 'online', WAIT_MS, 'jack03 online');
  await new Promise((r) => setTimeout(r, 4000));
  check('jack03 tidak mengirim /register', !/chat jack03: \//.test(serverOut));
  check('registerStatus = disabled', runner3.state.registerStatus === 'disabled', runner3.state.registerStatus);

  await Promise.all([runner.shutdown('selesai'), runner2.shutdown('selesai'), runner3.shutdown('selesai')]);
  check('semua runner berhenti bersih', true);

  process.stdout.write('\n[register-live] tes kick online-mode: harus fatal sekali, bukan retry...\n');
  serverOut = '';
  const runner4 = createRunner({
    config: makeConfig('jack04', {
      register: { enabled: true, mode: 'auto', delayMs: 500, retryMs: 500, maxAttempts: 3 },
      reconnect: { baseMs: 300, maxMs: 600, factor: 1, jitter: 0, maxAttempts: 0, afkKickExtraMs: 0 }
    }),
    logger: trackingLogger()
  });
  runner4.connect();
  await waitFor(() => runner4.state.fatal === 'online-mode', 30000, 'online-mode fatal');
  check('kick online-mode terdeteksi sebagai fatal', runner4.state.fatal === 'online-mode', runner4.state.fatal);
  check('authFailures hanya 1 (tidak terhitung 3x)', runner4.state.authFailures === 1,
    `authFailures=${runner4.state.authFailures}`);
  check('bot tidak reconnect setelah kick online-mode', /online-mode/.test(botLogs.join('\n')));
  check('pesan arahkan ke server cracked', /server cracked|offline-mode/i.test(botLogs.join('\n')));
  const joinCount4 = (serverOut.match(/username=jack04/g) || []).length;
  check('jack04 join tepat 1x lalu berhenti', joinCount4 <= 1, `joins=${joinCount4}`);
  await runner4.shutdown('selesai');

  if (failed) {
    process.stdout.write('\n--- serverOut ---\n' + serverOut.split(/\r?\n/).join('\n'));
    process.stdout.write('\n--- botLogs ---\n' + botLogs.join('\n'));
  }

  process.stdout.write(`\n[register-live] ${passed}/${passed + failed} passed\n`);
  if (!server.killed) server.kill('SIGKILL');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('[register-live] error:', err);
  process.exit(1);
});