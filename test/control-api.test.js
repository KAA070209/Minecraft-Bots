'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createController, COMMANDS } = require('../lib/control');
const { startControlApi, safeEqual } = require('../lib/api');
const { loadConfig } = require('../lib/config');
const { loadProfiles } = require('../lib/profiles');

const results = [];
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  results.push({ name, ok });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  plain: () => {}
};

function fakeTarget(name, extra = {}) {
  const state = {
    bot: null,
    behavior: null,
    combat: null,
    shop: null,
    farm: null,
    stopping: false,
    joinedAt: null,
    joins: 1,
    status: 'online',
    registerStatus: 'authenticated',
    backoff: { attempt: 0 },
    ...extra.state
  };
  return {
    name,
    status: 'online',
    register: 'authenticated',
    joins: 1,
    error: null,
    config: { server: { host: 'minesive.com', port: 25565 } },
    ...extra.target,
    runner: {
      state,
      reconnect: async () => {},
      shutdown: async () => {},
      ...extra.runner
    }
  };
}

async function controllerTests() {
  const one = [fakeTarget('AzkaSaadi')];
  const many = [fakeTarget('jack01'), fakeTarget('jack02')];

  const solo = createController({ getTargets: () => one });
  const multi = createController({ getTargets: () => many });

  const help = await solo.execute('help');
  check('help ok', help.ok === true);
  check('help berisi attack', help.results[0].lines.some((line) => line.startsWith('attack')), `${help.results[0].lines.length} baris`);
  check('help tidak punya target', help.targets.length === 0);

  const unknown = await solo.execute('attak jack01 on');
  check('perintah asing ditolak', unknown.ok === false);
  check('perintah asing memberi saran', unknown.results[0].lines[1].includes('attack'), unknown.results[0].lines[1]);

  const empty = await solo.execute('   ');
  check('baris kosong = help', empty.results[0].lines.length === COMMANDS.length);

  const soloStatus = await solo.execute('status');
  check('satu target: status tanpa nama jalan', soloStatus.ok === true);
  check('satu target: status menyebut username', soloStatus.results[0].lines.includes('username : AzkaSaadi'));

  const soloAttack = await solo.execute('attack on');
  check('satu target: argumen jadi argumen perintah', soloAttack.results[0].lines[0] === 'fitur pukul mob belum siap', soloAttack.results[0].lines[0]);

  const table = await multi.execute('status');
  check('multi target: status jadi tabel', table.results[0].lines[0].startsWith('BOT'), table.results[0].lines[0]);
  check('multi target: tabel berisi dua bot', table.results[0].lines.length === 4, `${table.results[0].lines.length} baris`);
  check('multi target: ringkasan online', table.results[0].lines[3].startsWith('2/2 online'));

  const oneStatus = await multi.execute('status jack02');
  check('status per nama', oneStatus.targets.join(',') === 'jack02', oneStatus.targets.join(','));
  check('status per nama detail', oneStatus.results[0].lines[0] === 'status   : online', oneStatus.results[0].lines[0]);

  const allStop = await multi.execute('stop all');
  check('stop all menyentuh semua bot', allStop.targets.length === 2, allStop.targets.join(','));
  check('stop all tetap ok tanpa fitur', allStop.ok === true);

  const broadcast = await multi.execute('sayall halo');
  check('sayall menyasar semua bot', broadcast.targets.join(',') === 'jack01,jack02', broadcast.targets.join(','));
  check('sayall gagal tanpa koneksi', broadcast.ok === false);

  const sayOne = await multi.execute('say jack01 halo');
  check('say per nama', sayOne.targets.join(',') === 'jack01');

  const walkMissing = await multi.execute('walk jack01');
  check('walk tanpa arah ditolak', walkMissing.ok === false);
  check('walk tanpa arah menyuruh isi', walkMissing.results[0].lines[0].includes('isi arah'), walkMissing.results[0].lines[0]);

  const walkBad = await multi.execute('walk jack01 ngawur');
  check('walk arah ngawur ditolak', walkBad.ok === false && /tidak dikenal|belum login/.test(walkBad.results[0].lines[0]), walkBad.results[0].lines[0]);

  const noBot = await multi.execute('harvest jack01 stop');
  check('fitur belum siap ditolak', noBot.ok === false);

  const inv = await multi.execute('inv jack01 carrot 5');
  check('inv tanpa koneksi ditolak', inv.results[0].lines[0] === 'bot belum punya koneksi');

  const lookup = await multi.execute('look jack01 90 10');
  check('look tanpa entity ditolak', lookup.ok === false);

  const solve = await multi.execute('solve 2+2');
  check('solve tanpa konfigurasi AI tidak crash', typeof solve.ok === 'boolean');
  check('solve isi jawaban', solve.results[0].lines.length >= 1, solve.results[0].lines.join(' | '));

  const solveEmpty = await multi.execute('solve');
  check('solve tanpa soal ditolak', solveEmpty.ok === false);

  const stopped = createController({ getTargets: () => [fakeTarget('jack01', { state: { stopping: true } })] });
  const shutdown = await stopped.execute('shutdown jack01');
  check('shutdown bot tidak aktif ditolak', shutdown.ok === false);

  const live = createController({ getTargets: () => [fakeTarget('jack01')] });
  const restart = await live.execute('restart jack01');
  check('restart bot aktif diterima', restart.ok === true);
  const shutdownLive = await live.execute('shutdown jack01');
  check('shutdown bot aktif diterima', shutdownLive.ok === true);

  const emptyController = createController({ getTargets: () => [] });
  const noTargets = await emptyController.execute('status');
  check('tanpa bot memberi pesan jelas', noTargets.ok === false && noTargets.error.includes('tidak ada bot'), noTargets.error);
}

async function apiTests() {
  const token = 'token-uji-123';
  const disabled = await startControlApi({ config: { api: { enabled: false } }, logger: silentLogger, getTargets: () => [] });
  check('api mati tidak listen', disabled === null);

  const noToken = await startControlApi({ config: { api: { enabled: true, token: null } }, logger: silentLogger, getTargets: () => [] });
  check('api tanpa token tidak listen', noToken === null);

  check('safeEqual bandingkan sama', safeEqual('abc', 'abc') === true);
  check('safeEqual bandingkan beda', safeEqual('abc', 'abd') === false);
  check('safeEqual beda panjang', safeEqual('abc', 'abcd') === false);

  const targets = [fakeTarget('jack01'), fakeTarget('jack02')];
  const server = await startControlApi({
    config: { api: { enabled: true, host: '127.0.0.1', port: 0, token, logRequests: false } },
    logger: silentLogger,
    getTargets: () => targets
  });
  check('api listen di port ephemeral', typeof server.port === 'number' && server.port > 0, String(server.port));
  const base = `http://127.0.0.1:${server.port}`;

  const get = async (path, headers = {}) => {
    const response = await fetch(base + path, { headers });
    return { status: response.status, body: await response.json() };
  };
  const post = async (path, body, headers = {}) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  const auth = { authorization: `Bearer ${token}` };

  const health = await get('/health');
  check('health tanpa token boleh', health.status === 200 && health.body.ok === true);
  check('health melaporkan jumlah bot', health.body.bots === 2, String(health.body.bots));

  const unauthorized = await get('/api/status');
  check('tanpa token ditolak', unauthorized.status === 401, String(unauthorized.status));

  const wrong = await get('/api/status', { authorization: 'Bearer salah' });
  check('token salah ditolak', wrong.status === 401);

  const queryToken = await get(`/api/status?token=${token}`);
  check('token lewat query diterima', queryToken.status === 200);
  check('status api punya daftar bot', queryToken.body.bots.map((bot) => bot.name).join(',') === 'jack01,jack02');

  const commands = await get('/api/commands', auth);
  check('daftar perintah tersedia', commands.status === 200 && commands.body.commands.length === COMMANDS.length);

  const status = await post('/api/command', { line: 'status jack01' }, auth);
  check('command dijalankan', status.status === 200 && status.body.ok === true);
  check('command menyasar satu bot', status.body.targets.join(',') === 'jack01');

  const failedCommand = await post('/api/command', { line: 'attack all on' }, auth);
  check('command gagal tetap HTTP 200', failedCommand.status === 200 && failedCommand.body.ok === false);

  const plainBody = await post('/api/command', 'status jack02', auth);
  check('body teks polos diterima', plainBody.status === 200 && plainBody.body.targets.join(',') === 'jack02');

  const queryLine = await post('/api/command?line=status%20jack01', undefined, auth);
  check('line lewat query diterima', queryLine.status === 200 && queryLine.body.targets.join(',') === 'jack01');

  const missing = await post('/api/command', {}, auth);
  check('tanpa line ditolak', missing.status === 400 && missing.body.ok === false);

  const unknownPath = await get('/api/entah', auth);
  check('endpoint asing 404', unknownPath.status === 404);

  const wrongMethod = await get('/api/command', auth);
  check('GET ke /api/command ditolak', wrongMethod.status === 404, String(wrongMethod.status));

  let limited = false;
  for (let i = 0; i < 70; i += 1) {
    const response = await get('/api/commands', auth);
    if (response.status === 429) {
      limited = true;
      break;
    }
  }
  check('rate limit menahan spam', limited === true);

  await server.close();
}

async function platformTests() {
  // MC_NO_ENV_FILE: uji ini harus/blobat Settingan mesin, bukan .env.local.
  // Railway memberi PORT sendiri dan hanya menjangkau service yang bind ke 0.0.0.0.
  const railway = loadConfig([], {
    MC_NO_ENV_FILE: '1',
    MC_API: '1',
    MC_API_TOKEN: 'token-uji',
    PORT: '8080',
    RAILWAY_ENVIRONMENT: 'production'
  });
  check('railway pakai host 0.0.0.0', railway.api.host === '0.0.0.0', railway.api.host);
  check('railway ikut pakai PORT', railway.api.port === 8080, String(railway.api.port));
  check('railway api aktif', railway.api.enabled === true);

  const local = loadConfig([], { MC_NO_ENV_FILE: '1', MC_API: '1', MC_API_TOKEN: 'token-uji' });
  check('lokal tetap 127.0.0.1', local.api.host === '127.0.0.1', local.api.host);
  check('lokal tetap port 8787', local.api.port === 8787, String(local.api.port));

  const emptyConfig = path.join(os.tmpdir(), `mc-afk-bot-uji-${process.pid}.json`);
  fs.writeFileSync(emptyConfig, JSON.stringify({ account: { username: 'jack01' } }));
  let refused = false;
  try {
    loadConfig([], { MC_NO_ENV_FILE: '1', MC_CONFIG: emptyConfig, MC_API: '1', PORT: '8080', RAILWAY_ENVIRONMENT: 'production' });
  } catch (err) {
    refused = /0\.0\.0\.0/.test(err.message);
  }
  check('0.0.0.0 tanpa token ditolak', refused);
  fs.unlinkSync(emptyConfig);

  // Profil dari env: password tidak perlu ada di image/git.
  const fromEnv = loadProfiles(path.join(os.tmpdir(), 'tidak-ada-profil.json'), {
    env: { MC_PROFILES_JSON: JSON.stringify({ profiles: [{ name: 'railwayBot', password: 'rahasia123' }] }) }
  });
  check('profil terbaca dari env', fromEnv.profiles.length === 1);
  check('password dari env dipakai', fromEnv.profiles[0].password === 'rahasia123');
  check('file path env ditandai', fromEnv.filePath.includes('dari env'), fromEnv.filePath);

  let missingHint = '';
  try {
    loadProfiles(path.join(os.tmpdir(), 'tidak-ada-profil.json'), { env: {} });
  } catch (err) {
    missingHint = err.message;
  }
  check('error profil menyuruh pakai env', missingHint.includes('MC_PROFILES_JSON'));
}

async function main() {
  await controllerTests();
  await apiTests();
  await platformTests();
  const failed = results.filter((result) => !result.ok);
  process.stdout.write(`\n[control-api] ${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length) {
    process.exitCode = 1;
    assert.fail(`${failed.length} test gagal: ${failed.map((result) => result.name).join(', ')}`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});