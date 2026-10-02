'use strict';

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.TEST_PORT || '25567';

let server = null;
let kickServer = null;
let bot = null;
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) passed += 1;
  else failed += 1;
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(__dirname, 'local-server.js')], {
      cwd: ROOT,
      env: { ...process.env, TEST_PORT: PORT, TEST_KICK_AFTER: process.env.TEST_KICK_AFTER || '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    server.stdout.on('data', (d) => { out += d.toString(); });
    server.stderr.on('data', (d) => { out += d.toString(); });
    server.on('error', reject);
    setTimeout(() => resolve(out), 2500);
  });
}

function runBot(timeoutMs, extraArgs = [], readyPattern = /spawn di/) {
  return new Promise((resolve) => {
    let out = '';
    bot = spawn(process.execPath, [
      path.join(ROOT, 'index.js'),
      '--host', '127.0.0.1',
      '--port', PORT,
      '--version', '1.16',
      '--noFile',
      '--noRegister',
      ...extraArgs
    ], { cwd: ROOT, env: { ...process.env, MC_CONFIG: path.join(__dirname, '.tidak-ada-config.json'), MC_USERNAME: 'IntegrationBot' }, stdio: ['ignore', 'pipe', 'pipe'] });
    bot.stdout.on('data', (d) => { out += d.toString(); });
    bot.stderr.on('data', (d) => { out += d.toString(); });

    const started = Date.now();
    const minRunMs = 6000;
    const poll = setInterval(() => {
      const elapsed = Date.now() - started;
      const ready = readyPattern.test(out);
      if ((ready && elapsed > minRunMs) || elapsed > timeoutMs) {
        clearInterval(poll);
        if (!bot.killed) bot.kill();
        resolve(out);
      }
    }, 250);
  });
}

function cleanup() {
  if (bot && !bot.killed) bot.kill();
  if (server && !server.killed) server.kill();
  if (kickServer && !kickServer.killed) kickServer.kill();
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('uncaughtException', (err) => { cleanup(); throw err; });

(async () => {
  process.stdout.write('[integration] menyalakan server test lokal...\n');
  const serverOut = await startServer();

  process.stdout.write('\n[integration] uji mode "safe" (lompat + putar kepala)\n');
  const safeOut = await runBot(25000, ['--afk', 'safe', '--afkInterval', '1500'], /AFK bot aktif \(mode safe\)/);

  check('login berhasil', /login berhasil/.test(safeOut));
  check('spawn diterima', /spawn di/.test(safeOut));
  check('AFK bot aktif', /AFK bot aktif \(mode safe\)/.test(safeOut));
  check('tidak ada error runtime', !/\[.*ERROR\]|Error:/.test(safeOut), (safeOut.match(/ERROR[^\n]*/) || [''])[0]);
  check('tidak ada unhandled rejection', !/unhandled rejection|uncaught exception/.test(safeOut));

  process.stdout.write('\n[integration] uji mode "wander" (jalan ke blok aman)\n');
  const wanderOut = await runBot(25000, ['--afk', 'wander', '--afkInterval', '1500'], /AFK bot aktif \(mode wander\)/);
  check('mode wander aktif', /AFK bot aktif \(mode wander\)/.test(wanderOut));
  check('wander tanpa error', !/\[.*ERROR\]/.test(wanderOut));

  cleanup();

  process.stdout.write('\n[integration] uji auto-reconnect setelah dikick\n');
  const kickServer = spawn(process.execPath, [path.join(__dirname, 'local-server.js')], {
    cwd: ROOT,
    env: { ...process.env, TEST_PORT: PORT, TEST_KICK_AFTER: '4000' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let kickServerOut = '';
  kickServer.stdout.on('data', (d) => { kickServerOut += d.toString(); });
  kickServer.stderr.on('data', (d) => { kickServerOut += d.toString(); });
  await new Promise((r) => setTimeout(r, 2500));

  bot = spawn(process.execPath, [
    path.join(ROOT, 'index.js'),
    '--host', '127.0.0.1', '--port', PORT, '--version', '1.16',
    '--noFile', '--noRegister', '--afkInterval', '1500'
  ], { cwd: ROOT, env: { ...process.env, MC_CONFIG: path.join(__dirname, '.tidak-ada-config.json'), MC_USERNAME: 'ReconnectBot' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let reconnectOut = '';
  bot.stdout.on('data', (d) => { reconnectOut += d.toString(); });
  bot.stderr.on('data', (d) => { reconnectOut += d.toString(); });
  await new Promise((r) => setTimeout(r, 30000));
  if (!bot.killed) bot.kill();
  if (!kickServer.killed) kickServer.kill();

  const joins = (kickServerOut.match(/join \(\d+\)/g) || []).length;
  const spawns = (reconnectOut.match(/spawn di/g) || []).length;
  check('server melihat lebih dari 1 join', joins >= 2, `joins=${joins}`);
  check('bot spawn ulang setelah dikick', spawns >= 2, `spawns=${spawns}`);
  check('backoff dipakai', /sambung ulang dalam/.test(reconnectOut));
  check('sesi sebelumnya dicatat', /sesi berakhir setelah/.test(reconnectOut));
  check('tidak ada error saat reconnect', !/\[.*ERROR\]/.test(reconnectOut), (reconnectOut.match(/ERROR[^\n]*/) || [''])[0]);

  if (failed) {
    process.stdout.write('\n--- reconnectOut ---\n' + reconnectOut);
    process.stdout.write('\n--- kickServerOut ---\n' + kickServerOut);
  }

  console.log(`\n[integration] ${passed}/${passed + failed} passed`);
  cleanup();
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('integration error:', err);
  cleanup();
  process.exit(1);
});
