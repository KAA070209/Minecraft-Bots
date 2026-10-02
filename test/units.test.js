'use strict';

const { isFreeSpace, isSolidGround, findBestFood, foodScore } = require('../lib/behaviors');
const { Backoff } = require('../lib/backoff');
const { loadConfig, mergeDeep } = require('../lib/config');
const { formatDuration } = require('../lib/logger');

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition) });
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}

check('isFreeSpace air', isFreeSpace('air') === true);
check('isFreeSpace void_air', isFreeSpace('void_air') === true);
check('isFreeSpace grass_block false', isFreeSpace('grass_block') === false);
check('isFreeSpace lava false', isFreeSpace('lava') === false);
check('isFreeSpace undefined false', isFreeSpace(undefined) === false);

check('isSolidGround grass_block', isSolidGround('grass_block') === true);
check('isSolidGround dirt', isSolidGround('dirt') === true);
check('isSolidGround air false', isSolidGround('air') === false);
check('isSolidGround water false', isSolidGround('water') === false);
check('isSolidGround lava false', isSolidGround('lava') === false);
check('isSolidGround cactus false', isSolidGround('cactus') === false);

const fakeBot = {
  version: '1.20.1',
  inventory: {
    items: () => [
      { name: 'dirt', count: 5 },
      { name: 'bread', count: 3 },
      { name: 'apple', count: 2 },
      { name: 'golden_apple', count: 1 },
      { name: 'cooked_porkchop', count: 4 }
    ]
  }
};
const best = findBestFood(fakeBot);
check('findBestFood picks highest foodPoints (porkchop 8 > bread 5)', best && best.item.name === 'cooked_porkchop', best ? best.item.name : 'null');

const tieBot = {
  version: '1.20.1',
  inventory: {
    items: () => [
      { name: 'apple', count: 2 },
      { name: 'golden_apple', count: 1 }
    ]
  }
};
const tie = findBestFood(tieBot);
check('findBestFood breaks foodPoints tie by effectiveQuality', tie && tie.item.name === 'golden_apple', tie ? tie.item.name : 'null');

check('foodScore reads foodPoints from object entry', foodScore({ foodPoints: 7, effectiveQuality: 12 }).points === 7);
check('foodScore accepts plain number', foodScore(4).points === 4);
check('foodScore rejects undefined', foodScore(undefined) === null);
check('foodScore rejects entry without foodPoints', foodScore({ id: 1 }) === null);

const modernBot = {
  version: '26.1.2',
  inventory: { items: () => [{ name: 'golden_apple', count: 1 }, { name: 'bread', count: 9 }] }
};
const modern = findBestFood(modernBot);
check('findBestFood works on server version 26.1.2', modern && modern.item.name === 'bread', modern ? modern.item.name : 'null');

const emptyBot = { version: '1.20.1', inventory: { items: () => [{ name: 'dirt', count: 5 }] } };
check('findBestFood returns null without food', findBestFood(emptyBot) === null);

const badBot = { version: 'tidak-ada-versi-ini', inventory: { items: () => [] } };
check('findBestFood tolerates unknown version', findBestFood(badBot) === null);

const b = new Backoff({ baseMs: 1000, maxMs: 8000, factor: 2, jitter: 0 });
check('backoff grows exponentially', b.next() === 1000 && b.next() === 2000 && b.next() === 4000, `${b.attempt} attempts`);
check('backoff caps at maxMs', b.next() === 8000 && b.next() === 8000);
b.reset();
check('backoff reset works', b.next() === 1000);

const jittery = new Backoff({ baseMs: 1000, maxMs: 8000, factor: 1, jitter: 0.5 });
const samples = Array.from({ length: 60 }, () => jittery.next());
const inRange = samples.every((d) => d >= 500 && d <= 1500);
check('backoff jitter stays within bounds', inRange, `min=${Math.min(...samples)} max=${Math.max(...samples)}`);

const merged = mergeDeep({ a: { b: 1, c: 2 }, d: 3 }, { a: { c: 9 }, d: undefined });
check('mergeDeep merges nested and skips undefined', merged.a.b === 1 && merged.a.c === 9 && merged.d === 3, JSON.stringify(merged));

const cfg = loadConfig(['--host', 'example.com', '--port', '1234', '--afk', 'wander'], {});
check('loadConfig applies CLI args', cfg.server.host === 'example.com' && cfg.server.port === 1234 && cfg.afk.mode === 'wander');

const envCfg = loadConfig([], { MC_HOST: 'env.com', MC_PORT: '25566', MC_AFK_MODE: 'look' });
check('loadConfig applies env vars', envCfg.server.host === 'env.com' && envCfg.server.port === 25566 && envCfg.afk.mode === 'look');

const inverted = loadConfig(['--afkInterval', '20000'], {});
check('maxInterval never below minInterval', inverted.afk.maxIntervalMs >= inverted.afk.minIntervalMs);

check('formatDuration seconds', formatDuration(5000) === '5s', formatDuration(5000));
check('formatDuration minutes', formatDuration(65000) === '1m 5s', formatDuration(65000));
check('formatDuration hours', formatDuration(3725000) === '1h 2m 5s', formatDuration(3725000));
check('formatDuration days', formatDuration(90000000) === '1d 1h 0m 0s', formatDuration(90000000));
check('formatDuration invalid', formatDuration(-1) === 'n/a');

process.stdout.write('\n');
const { createLogger } = require('../lib/logger');
const { extractKickReason, ONLINE_MODE_KICK_PATTERN, AUTH_KICK_PATTERN, AFK_KICK_PATTERN } = require('../lib/runner');

process.stdout.write('[units] logger: tidak ada "undefined" di output\n');
{
  const originalIsTty = process.stdout.isTTY;
  const originalWrite = process.stdout.write;
  const originalErrWrite = process.stderr.write;
  let out = '';
  let err = '';
  process.stdout.isTTY = true;
  process.stdout.write = (chunk) => { out += chunk; return true; };
  process.stderr.write = (chunk) => { err += chunk; return true; };
  try {
    const log = createLogger({ file: null, color: true, level: 'debug', prefix: '[jack01] ' });
    log.debug('d');
    log.info('i');
    log.success('s');
    log.warn('w');
    log.error('e');
    log.plain('p');
    log.raw('gray', 'r');
    log.raw('\u001b[35m', 'raw-esc');
  } finally {
    process.stdout.isTTY = originalIsTty;
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrWrite;
  }
  const all = out + err;
  check('tidak ada "undefined" di stdout', !/undefined/.test(out), (out.match(/undefined/) || [''])[0]);
  check('tidak ada "undefined" di stderr', !/undefined/.test(err), (err.match(/undefined/) || [''])[0]);
  check('prefix dipakai', all.includes('[jack01]'));
  check('warna cyan dipakai', out.includes('\u001b[36m'));
  check('warna hijau dipakai', out.includes('\u001b[32m'));
  check('warna kuning dipakai (warn -> stdout)', out.includes('\u001b[33m'));
  check('warna merah dipakai (error -> stderr)', err.includes('\u001b[31m'));
  check('warn ada di stdout', out.includes('WARN'));
  check('warn tidak di stderr', !err.includes('WARN'));
  check('error ada di stderr', err.includes('ERROR'));
  check('error tidak di stdout', !out.includes('ERROR'));
  check('raw dengan nama warna', out.includes('\u001b[90m'));
  check('raw dengan escape langsung', out.includes('\u001b[35m'));
  check('semua level muncul', ['d', 'i', 's', 'w', 'e', 'p', 'r'].every((tag) => all.includes(tag)));
}

process.stdout.write('\n');
process.stdout.write('[units] kick classification\n');
{
  const minesive = '{"color":"red","text":"You are not logged into your Minecraft account. If you are logged into your Minecraft account, try restarting your Minecraft client."}';
  const reason = extractKickReason(JSON.parse(minesive));
  check('extractKickReason baca text JSON', reason.startsWith('You are not logged into'), reason);
  check('kick minesive kena pola online-mode', ONLINE_MODE_KICK_PATTERN.test(reason));
  check('kick minesive juga kena auth kick', AUTH_KICK_PATTERN.test(reason));
  check('kick minesive bukan AFK kick', !AFK_KICK_PATTERN.test(reason));
  check('kick AFK terdeteksi', AFK_KICK_PATTERN.test('You were idle for too long'));
  check('kick "belum terdaftar" terdeteksi', AUTH_KICK_PATTERN.test('You are not registered. Please register first.'));
  check('kick "belum terdaftar" bukan online-mode', !ONLINE_MODE_KICK_PATTERN.test('You are not registered.'));
  check('extractKickReason array digabung', extractKickReason([{ text: 'a' }, { text: 'b' }]) === 'a | b');
  check('extractKickReason baca description', extractKickReason({ description: 'd' }) === 'd');
  check('extractKickReason null', extractKickReason(null) === null);
}

process.stdout.write('\n');
process.stdout.write('[units] prefix perintah console\n');
{
  const { stripPrefix } = require('../lib/console');
  check('prefix ! dibuang', stripPrefix('!status', '!') === 'status');
  check('prefix ! di tengah', stripPrefix('!say halo dunia', '!') === 'say halo dunia');
  check('tanpa prefix -> teks utuh', stripPrefix('status', '!') === 'status');
  check('prefix kosong -> tidak ada karakter hilang', stripPrefix('status', '') === 'status', stripPrefix('status', ''));
  check('prefix undefined -> teks utuh', stripPrefix('quit', undefined) === 'quit');
  check('prefix multi karakter', stripPrefix('::status', '::') === 'status');
  check('prefix <> tidak dipaksa', stripPrefix('<>status', '<>') === 'status');
}

process.stdout.write('\n');
process.stdout.write('[units] override register per profil\n');
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { loadProfiles } = require('../lib/profiles');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-'));
  const file = path.join(dir, 'p.json');
  fs.writeFileSync(file, JSON.stringify({
    defaults: { register: { enabled: true, mode: 'login', retryMs: 6000 }, afk: { mode: 'safe' } },
    profiles: [
      { name: 'AzkaSaadi', password: 'rahasia1' },
      { name: 'Azka01', password: 'rahasia2', register: { mode: 'register' } },
      { name: 'Azka02', register: { mode: 'off' } },
      { name: 'Azka03', overrides: { register: { mode: 'register' } } },
      { name: 'Azka04', register: { mode: 'register' }, overrides: { afk: { mode: 'wander' } } }
    ]
  }));
  const by = Object.fromEntries(loadProfiles(file).profiles.map((p) => [p.name, p]));
  check('default mode login', by.AzkaSaadi.config.register.mode === 'login');
  check('password profil dipakai', by.AzkaSaadi.password === 'rahasia1');
  check('per-profil register: register dipakai', by.Azka01.config.register.mode === 'register', by.Azka01.config.register.mode);
  check('per-profil register: password tetap', by.Azka01.password === 'rahasia2');
  check('per-profil register: key lain dari default', by.Azka01.config.register.retryMs === 6000, String(by.Azka01.config.register.retryMs));
  check('per-profil register: off dipakai', by.Azka02.config.register.mode === 'off', by.Azka02.config.register.mode);
  check('overrides tetap jalan', by.Azka03.config.register.mode === 'register');
  check('overrides afk tetap jalan', by.Azka04.config.afk.mode === 'wander');
  check('password null -> default config null', by.Azka02.password === null);
  fs.rmSync(dir, { recursive: true, force: true });
}

process.stdout.write('\n');
process.stdout.write('[units] chatGame per profil\n');
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { loadProfiles } = require('../lib/profiles');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgprof-'));
  const file = path.join(dir, 'p.json');
  fs.writeFileSync(file, JSON.stringify({
    defaults: { chatGame: { enabled: false, fuzzyThreshold: 0.84, delayMs: 700 } },
    profiles: [
      { name: 'AzkaSaadi', chatGame: { enabled: true, storeFile: 'logs/chatgame-memory-{username}.json' } },
      { name: 'Azka01' },
      { name: 'Azka02', chatGame: { enabled: true, fuzzyThreshold: 0.95 } },
      { name: 'Azka03', overrides: { chatGame: { enabled: true } } }
    ]
  }));
  const by = Object.fromEntries(loadProfiles(file).profiles.map((p) => [p.name, p]));
  check('per-profil chatGame aktif', by.AzkaSaadi.config.chatGame.enabled === true, String(by.AzkaSaadi.config.chatGame.enabled));
  check('storeFile ikut ter-merge', by.AzkaSaadi.config.chatGame.storeFile === 'logs/chatgame-memory-{username}.json');
  check('key lain dari default kept', by.AzkaSaadi.config.chatGame.fuzzyThreshold === 0.84, String(by.AzkaSaadi.config.chatGame.fuzzyThreshold));
  check('profil lain tetap mati', by.Azka01.config.chatGame.enabled === false, String(by.Azka01.config.chatGame.enabled));
  check('fuzzyThreshold per-profil', by.Azka02.config.chatGame.fuzzyThreshold === 0.95, String(by.Azka02.config.chatGame.fuzzyThreshold));
  check('overrides chatGame jalan', by.Azka03.config.chatGame.enabled === true);
  fs.rmSync(dir, { recursive: true, force: true });
}

process.stdout.write('\n');
process.stdout.write('[units] validasi chatGame\n');
{
  const { validateProfile } = require('../lib/profiles');
  check('chatGame bukan objek ditolak', validateProfile({ name: 'Azka01', chatGame: 'iya' }, 0).some((e) => e.includes('chatGame')));
  check('chatGame array ditolak', validateProfile({ name: 'Azka01', chatGame: [] }, 0).some((e) => e.includes('chatGame')));
  check('enabled non-boolean ditolak', validateProfile({ name: 'Azka01', chatGame: { enabled: 'ya' } }, 0).some((e) => e.includes('enabled')));
  check('fuzzyThreshold >1 ditolak', validateProfile({ name: 'Azka01', chatGame: { fuzzyThreshold: 3 } }, 0).some((e) => e.includes('fuzzyThreshold')));
  check('api tanpa endpoint ditolak', validateProfile({ name: 'Azka01', chatGame: { api: { enabled: true } } }, 0).some((e) => e.includes('endpoint')));
  check('api lengkap diterima', validateProfile({ name: 'Azka01', chatGame: { api: { enabled: true, endpoint: 'http://x', apiKey: 'k' } } }, 0).length === 0);
  check('konfigurasi valid diterima', validateProfile({ name: 'Azka01', chatGame: { enabled: true, storeFile: 'a.json' } }, 0).length === 0);
}

process.stdout.write('\n');
process.stdout.write('[units] template perintah register\n');
{
  const { buildCommand } = require('../lib/register');
  const { loadConfig } = require('../lib/config');
  const authme = loadConfig([], { MC_CONFIG_JSON: JSON.stringify({ register: {} }) });
  const single = loadConfig([], { MC_CONFIG_JSON: JSON.stringify({ register: { commandTemplate: '/register {password}' } }) });
  const custom = loadConfig([], { MC_CONFIG_JSON: JSON.stringify({ register: { commandTemplate: '/reg {username} {password}', loginTemplate: '/l {password}' } }) });
  check('default AuthMe 2 argumen', buildCommand('register', authme, 'Azka01', 'Azka01') === '/register Azka01 Azka01', buildCommand('register', authme, 'Azka01', 'Azka01'));
  check('default login', buildCommand('login', authme, 'Azka01', 'Azka01') === '/login Azka01');
  check('template 1 argumen dipakai', buildCommand('register', single, 'Azka01', 'rahasia') === '/register rahasia', buildCommand('register', single, 'Azka01', 'rahasia'));
  check('{username} diisi', buildCommand('register', custom, 'Azka01', 'rahasia') === '/reg Azka01 rahasia', buildCommand('register', custom, 'Azka01', 'rahasia'));
  check('loginTemplate dipakai', buildCommand('login', custom, 'Azka01', 'rahasia') === '/l rahasia');
  check('password di template login tetap dipakai saat mode register', buildCommand('register', authme, 'X', 'Y') === '/register Y Y');
  let threw = false;
  try { loadConfig([], { MC_CONFIG_JSON: JSON.stringify({ register: { commandTemplate: '/register' } }) }); } catch { threw = true; }
  check('template tanpa {password} ditolak', threw);
  threw = false;
  try { loadConfig([], { MC_CONFIG_JSON: JSON.stringify({ register: { loginTemplate: 123 } }) }); } catch { threw = true; }
  check('template bukan string ditolak', threw);
}

process.stdout.write('\n');
process.stdout.write('[units] password tidak boleh memuat nickname\n');
{
  const { validateProfile } = require('../lib/profiles');
  const bad = (name, password) => validateProfile({ name, password }, 0).join(' ');
  check('sama persis ditolak', /memuat nickname/.test(bad('Azka01', 'Azka01')));
  check('beda huruf besar ditolak', /memuat nickname/.test(bad('Azka01', 'azka01')));
  check('nickname penuh di tengah password ditolak', /memuat nickname/.test(bad('Azka01', 'xAzka01y')));
  check('password aman diterima', bad('Azka01', 'sh7z*7d') === '', bad('Azka01', 'sh7z*7d'));
  check('tanpa password tidak error', bad('Azka01', null) === '');
  check('password tidak undefined tidak error', validateProfile({ name: 'Azka01' }, 0).join(' ') === '');
  check('huruf besar saja tetap ditolak', /memuat nickname/.test(bad('Azka01', 'AZKA01')));
}

process.stdout.write('\n');
process.stdout.write('[units] kontrol gerak manual\n');
{
  const { manualWalk, manualStop, DIRECTIONS } = require('../lib/behaviors');
  const makeBot = () => {
    const bot = { entity: { onGround: true }, states: {}, setControlState(k, v) { this.states[k] = v; }, clearControlStates() { this.states = {}; } };
    return bot;
  };

  const bot = makeBot();
  const fwd = manualWalk(bot, 'maju', 1500);
  check('maju -> forward', fwd.ok && fwd.state === 'forward', JSON.stringify(fwd));
  check('maju mengaktifkan forward', bot.states.forward === true);
  check('maju ikut sprint', bot.states.sprint === true);
  check('durasi dipakai', fwd.ms === 1500, String(fwd.ms));

  const kiri = manualWalk(bot, 'kiri', 500);
  check('kiri -> left', kiri.ok && kiri.state === 'left');
  check('arah baru menimpa yang lama', bot.states.forward === undefined && bot.states.left === true);
  check('sprint dimatikan saat belok', bot.states.sprint === undefined);

  check('lompat dikenal', manualWalk(bot, 'lompat', 300).state === 'jump');
  check('jongkok dikenal', manualWalk(bot, 'jongkok', 300).state === 'sneak');

  const bad = manualWalk(bot, 'datar', 500);
  check('arah ngawur ditolak', bad.ok === false && /tidak dikenal/.test(bad.error), JSON.stringify(bad));
  check('error sebut pilihan', /forward/.test(bad.error));

  check('bot tanpa entity ditolak', manualWalk({ states: {} }, 'maju', 100).ok === false);
  check('tanpa bot ditolak', manualWalk(null, 'maju', 100).ok === false);

  const clampBot = makeBot();
  check('durasi terlalu besar dibatasi 60000', manualWalk(clampBot, 'maju', 999999).ms === 60000);
  check('durasi ngawur dibatasi minimal 100', manualWalk(clampBot, 'maju', -5).ms === 100);
  check('tanpa durasi default 2000', manualWalk(clampBot, 'maju').ms === 2000);

  const stopBot = makeBot();
  manualWalk(stopBot, 'maju', 5000);
  check('manualStop mengembalikan true saat jalan', manualStop(stopBot) === true);
  check('semua state dibersihkan', Object.keys(stopBot.states).length === 0, JSON.stringify(stopBot.states));
  check('manualStop kedua kali false', manualStop(stopBot) === false);
  check('directions tetap punya 5 arah dasar',
    ['forward', 'back', 'left', 'right', 'jump'].every((k) => Object.values(DIRECTIONS).includes(k)));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[units] ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
