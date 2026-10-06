'use strict';

const fs = require('fs');
const path = require('path');

// Batas jeda ayunan milik combat, dipakai untuk mengubahnya jadi batas CPS
// yang valid (cpsMin/cpsMax) supaya dua tempat tidak punya angka sendiri.
const { MIN_ATTACK_INTERVAL, MAX_ATTACK_INTERVAL } = require('./combat');

const VALID_REGISTER_MODES = ['off', 'auto', 'login', 'register'];

// Kotak lahan (farm.area.bounds) dibatasi 256 blok per sisi supaya scan penuh
// tidak bisa meledak jadi ratusan ribu blockAt.
const MAX_FARM_SPAN = 256;

const DEFAULTS = {
  server: { host: 'minesive.com', port: 25565 },
  account: { username: 'jack01' },
  version: null,
  join: { spawnTimeoutMs: 90000, autoJoin: true, autoReconnect: true },
  register: {
    enabled: true,
    mode: 'auto',
    password: null,
    delayMs: 1500,
    retryMs: 6000,
    maxAttempts: 3,
    maxAuthFailures: 3
  },
  chatGame: {
    enabled: false,
    delayMs: 20,
    minIntervalMs: 700,
    maxQueue: 5,
    solo: true,
    soloWindowMs: 10000,
    mathFirst: true,
    debugRaw: false,
    minRiddleChars: 4,
    minResidueChars: 6,
    fuzzyThreshold: 0.84,
    dedupeMs: 3000,
    maxAnswerLength: 48,
    storeFile: null,
    answersFile: null,
    patterns: {
      detect: '(chat\\s*games?|tebak|guess|riddle|谜语|謎語)',
      reveal: 'jawaban\\s*:\\s*(.+)',
      ignore: '(hadiah|tercepat|berhasil|terkirim|peringkat|per peringkat|selamat|menang|kalah|memperoleh|pemenang|\\bskor\\b|\\bboard\\b|\\btop\\s*\\d|untuk\\s+peringkat)'
    },
    api: {
      enabled: true,
      endpoint: '',
      apiKey: '',
      model: 'gpt-4o-mini',
      maxTokens: 16,
      timeoutMs: 1500,
      systemPrompt:
        'Kamu menjawab soal game chat. Balas HANYA jawaban final, satu kata atau satu angka, tanpa tanda kutip, tanpa penjelasan, tanpa satuan.'
    }
  },
  afk: {
    mode: 'safe',
    minIntervalMs: 25000,
    maxIntervalMs: 55000,
    yawStepDeg: 70,
    pitchMinDeg: -25,
    pitchMaxDeg: 15,
    swingArm: true,
    jumpChance: 0.45
  },
  survival: { autoEat: true, eatBelowFood: 18, eatBelowHealth: 17, rescue: true, lowHealthQuit: 0 },
  combat: {
    enabled: false,
    range: 12,
    // Default: kejar mob sampai masuk jangkauan serang agar auto-combat efektif.
    approach: true,
    // Pakai jangkauan pedang vanilla agar bot bisa menyerang dari balik pagar/blok.
    attackRange: 3,
    intervalMs: 500,
    attackCooldownMs: 1000,
    // Auto clicker: click rate diacak antara batas ini tiap klik, supaya pola
    // ayunan tidak terlihat tetap. null/null = pakai attackCooldownMs tetap.
    cpsMin: null,
    cpsMax: null,
    equipRetryMs: 1000,
    // Tinggi bidikan di atas kaki mob: 0,8 = bagian bawah badan, cukup rendah
    // untuk mob kecil (slime, tupai) tapi tidak menusuk tanah.
    aimHeight: 0.8,
    retreatBelowHealth: 6,
    jumpWhenBlocked: true,
    stuckTimeoutMs: 3000,
    giveUpMs: 15000,
    attackPlayers: false,
    whitelist: [],
    ignore: []
  },
  shop: {
    enabled: false,
    mode: 'gui',
    command: '/shop',
    items: ['carrot', 'wheat', 'cooked_beef'],
    amount: 64,
    amounts: {},
    intervalMs: 300000,
    buyIntervalMs: 1500,
    openDelayMs: 1500,
    dumpDelayMs: 1000,
    maxBuyPerCycle: 8,
    dumpWhenFull: true,
    reserveSlots: 1,
    shiftBuy: false,
    closeAfter: true,
    keep: ['shield', 'elytra', 'totem_of_undying']
  },
  farm: {
    enabled: false,
    area: { x: 0, y: 64, z: 0, radius: 8 },
    crops: ['carrots', 'wheat', 'potatoes'],
    scanHeight: 2,
    scanIntervalMs: 15000,
    harvestIntervalMs: 400,
    approachStepMs: 150,
    approachAttempts: 12,
    reach: 3.2,
    walkToRadius: 24,
    maxWalkDistance: 64,
    autoDiscover: true,
    searchRadius: 32,
    searchIntervalMs: 30000,
    walkTimeoutMs: 8000,
    walkStepMs: 250,
    dropWaitMs: 1500,
    dropStepMs: 150,
    pickupRadius: 12,
    pickupStepMs: 150,
    pickupAttempts: 14,
    dropMemoryMs: 120000,
    sweepDrops: true,
    sweepLimit: 8,
    maxPerCycle: 0,
    betweenCycleMs: 600,
    pathRadius: 24,
    replant: true,
    replantItem: null,
    useTool: true,
    cropWalkSteps: 0,
    chaseRange: 0,
    harvestCooldownMs: 60000,
    jumpToClimb: false,
    jumpCooldownMs: 1500,
    sprint: false
  },
  reconnect: { baseMs: 6000, maxMs: 180000, factor: 1.8, jitter: 0.3, maxAttempts: 0, afkKickExtraMs: 90000 },
  logging: { level: 'info', file: './logs/afk-bot.log', color: true, logChat: true, maxLogFileBytes: 5242880 },
  console: { enabled: true, commandPrefix: '!' },
  // API kontrol lokal (dipakai discord-bot lewat HTTP). Wajib diisi token kalau
  // diaktifkan, karena proses ini bisa menyalakan/mematikan bot.
  api: { enabled: false, host: '127.0.0.1', port: 8787, token: null, logRequests: true }
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value === undefined) continue;
    result[key] = isPlainObject(value) && isPlainObject(base[key]) ? mergeDeep(base[key], value) : value;
  }
  return result;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      args[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args[body] = argv[i + 1];
      i += 1;
    } else {
      args[body] = true;
    }
  }
  return args;
}

function coerce(raw) {
  if (typeof raw !== 'string') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function fromEnv(env) {
  const out = {};
  if (env.MC_HOST) out.server = { host: env.MC_HOST };
  if (env.MC_PORT) out.server = { ...out.server, port: Number(env.MC_PORT) };
  if (env.MC_USERNAME) out.account = { ...out.account, username: env.MC_USERNAME };
  if (env.MC_VERSION) out.version = env.MC_VERSION;
  if (env.MC_REGISTER_MODE) out.register = { mode: env.MC_REGISTER_MODE };
  if (env.MC_REGISTER_PASSWORD) out.register = { ...out.register, password: env.MC_REGISTER_PASSWORD };
  if (env.MC_NO_REGISTER) out.register = { enabled: false };
  if (env.MC_AFK_MODE) out.afk = { mode: env.MC_AFK_MODE };
  if (env.MC_AFK_INTERVAL) {
    const interval = Number(env.MC_AFK_INTERVAL);
    out.afk = { ...out.afk, minIntervalMs: interval, maxIntervalMs: interval };
  }
  if (env.MC_COMBAT) out.combat = { enabled: env.MC_COMBAT !== '0' && env.MC_COMBAT !== 'false' };
  if (env.MC_SHOP) out.shop = { enabled: env.MC_SHOP !== '0' && env.MC_SHOP !== 'false' };
  if (env.MC_SHOP_COMMAND) out.shop = { ...out.shop, command: env.MC_SHOP_COMMAND };
  if (env.MC_FARM) out.farm = { enabled: env.MC_FARM !== '0' && env.MC_FARM !== 'false' };
  if (env.MC_LOG_LEVEL) out.logging = { level: env.MC_LOG_LEVEL };
  if (env.MC_API) out.api = { enabled: env.MC_API !== '0' && env.MC_API !== 'false' };
  if (env.MC_API_HOST) out.api = { ...out.api, host: env.MC_API_HOST };
  if (env.MC_API_PORT) out.api = { ...out.api, port: Number(env.MC_API_PORT) };
  if (env.MC_API_TOKEN) out.api = { ...out.api, token: env.MC_API_TOKEN };
  // Platform PaaS (Railway, Heroku) hanya menjangkau service yang bind ke
  // 0.0.0.0 dan memberi PORT sendiri, jadi pakai keduanya kalau terdeteksi.
  if (env.PORT && !env.MC_API_PORT) out.api = { ...out.api, port: Number(env.PORT) };
  if ((env.RAILWAY_ENVIRONMENT || env.RAILWAY_SERVICE_ID) && !env.MC_API_HOST) {
    out.api = { ...out.api, host: '0.0.0.0' };
  }
  return out;
}

function fromArgs(args) {
  const out = {};
  if (args.host) out.server = { host: args.host };
  if (args.port) out.server = { ...out.server, port: Number(args.port) };
  if (args.username || args.name) out.account = { ...out.account, username: args.username || args.name };
  if (args.version) out.version = args.version;
  if (args.register) out.register = { mode: args.register };
  if (args.registerPassword) out.register = { ...out.register, password: args.registerPassword };
  if (args.noRegister) out.register = { enabled: false };
  if (args.log) out.logging = { level: args.log };
  if (args.afk) out.afk = { mode: args.afk };
  if (args.afkInterval) {
    out.afk = { ...out.afk, minIntervalMs: Number(args.afkInterval), maxIntervalMs: Number(args.afkInterval) };
  }
  if (args.noFile) out.logging = { file: null };
  if (args.combat) out.combat = { enabled: true };
  if (args.shop) out.shop = { ...(out.shop || {}), enabled: true, command: args.shop };
  if (args.farm) out.farm = { enabled: true };
  if (args.api) out.api = { enabled: true };
  if (args.apiHost) out.api = { ...out.api, host: args.apiHost };
  if (args.apiPort) out.api = { ...out.api, port: Number(args.apiPort) };
  if (args.apiToken) out.api = { ...out.api, token: args.apiToken };
  return out;
}

function readLocalEnvFile(file) {
  // .env.local dipakai untuk setting mesin ini saja (token API, port, dst) dan
  // tidak ikut ter-commit. Nilai asli dari environment selalu menang.
  if (!file || !fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '').trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).trim();
    }
    if (key) out[key] = value;
  }
  return out;
}

function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const root = path.join(__dirname, '..');
  // MC_ENV_FILE menunjuk file .env lain (dipakai test), default .env.local.
  const localEnvFile = env.MC_ENV_FILE ? path.resolve(env.MC_ENV_FILE) : path.join(root, '.env.local');
  const fileEnv = env.MC_NO_ENV_FILE ? {} : readLocalEnvFile(localEnvFile);
  const mergedEnv = { ...fileEnv, ...env };
  const configPath = mergedEnv.MC_CONFIG ? path.resolve(mergedEnv.MC_CONFIG) : path.join(root, 'config.json');
  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  if (mergedEnv.MC_CONFIG_JSON) {
    try {
      fileConfig = mergeDeep(fileConfig, JSON.parse(mergedEnv.MC_CONFIG_JSON));
    } catch (err) {
      process.stderr.write(`MC_CONFIG_JSON tidak bisa di-parse, diabaikan: ${err.message}\n`);
    }
  }

  const args = parseArgs(argv);
  const argsConfig = fromArgs(args);
  const envConfig = fromEnv(mergedEnv);

  let config = mergeDeep(DEFAULTS, fileConfig);
  config = mergeDeep(config, envConfig);
  config = mergeDeep(config, argsConfig);

  config.server.port = Number(config.server.port);
  config.join.spawnTimeoutMs = Number(config.join.spawnTimeoutMs);
  config.register.delayMs = Number(config.register.delayMs);
  config.register.retryMs = Number(config.register.retryMs);
  config.register.maxAttempts = Number(config.register.maxAttempts);
  config.register.maxAuthFailures = Number(config.register.maxAuthFailures);
  config.afk.minIntervalMs = Number(config.afk.minIntervalMs);
  config.afk.maxIntervalMs = Number(config.afk.maxIntervalMs);
  if (config.afk.maxIntervalMs < config.afk.minIntervalMs) {
    config.afk.maxIntervalMs = config.afk.minIntervalMs;
  }

  config.combat.range = Number(config.combat.range) || 12;
  // false = jangandekati: target langsung dipukul dari posisi bot, jadi bot
  // tidak akan pernah dicoret karena gagal mendekati mob.
  config.combat.approach = config.combat.approach !== false;
  config.combat.attackRange = Math.max(0.5, Number(config.combat.attackRange) || 3);
  config.combat.intervalMs = Math.max(100, Number(config.combat.intervalMs) || 500);
  // 0 = spam tanpa jeda (auto clicker), combat.js yang membatasi minimalnya
  // supaya loop tidak jadi spinning 100% CPU.
  config.combat.attackCooldownMs = Math.min(
    2000,
    Math.max(0, Number(config.combat.attackCooldownMs) || 0)
  );
  // CPS acak: hanya dipakai kalau cpsMin valid. Batas mengikuti jeda ayunan
  // (25-2000 ms), jadi "40" = secepat batas, 0.5 = satu klik tiap 2 detik.
  const MIN_CLICK_CPS = 1000 / MAX_ATTACK_INTERVAL;
  const MAX_CLICK_CPS = 1000 / MIN_ATTACK_INTERVAL;
  for (const key of ['cpsMin', 'cpsMax']) {
    const raw = Number(config.combat[key]);
    config.combat[key] = Number.isFinite(raw) && raw > 0
      ? Math.min(MAX_CLICK_CPS, Math.max(MIN_CLICK_CPS, raw))
      : null;
  }
  if (config.combat.cpsMax !== null && config.combat.cpsMin !== null && config.combat.cpsMax < config.combat.cpsMin) {
    config.combat.cpsMax = config.combat.cpsMin;
  }
  config.combat.equipRetryMs = Math.max(0, Number(config.combat.equipRetryMs) || 1000);
      // Bidikan dibatasi di dalam hitbox mob (0..1.8 blok dari kakinya).
      if (config.combat.aimHeight !== undefined) {
        config.combat.aimHeight = Math.min(1.8, Math.max(0, Number(config.combat.aimHeight) || 0));
      }
  config.combat.stuckTimeoutMs = Math.max(500, Number(config.combat.stuckTimeoutMs) || 3000);
  config.combat.giveUpMs = Math.max(1000, Number(config.combat.giveUpMs) || 15000);
  config.combat.jumpWhenBlocked = config.combat.jumpWhenBlocked !== false;
  if (!Array.isArray(config.combat.whitelist)) config.combat.whitelist = [];
  if (!Array.isArray(config.combat.ignore)) config.combat.ignore = [];

  if (config.shop.mode !== 'command') config.shop.mode = 'gui';
  if (!Array.isArray(config.shop.items)) config.shop.items = [];
  if (!config.shop.amounts || typeof config.shop.amounts !== 'object') config.shop.amounts = {};
  config.shop.amount = Math.max(1, Number(config.shop.amount) || 64);
  config.shop.intervalMs = Math.max(5000, Number(config.shop.intervalMs) || 300000);
  config.shop.buyIntervalMs = Math.max(200, Number(config.shop.buyIntervalMs) || 1500);
  config.shop.maxBuyPerCycle = Math.max(0, Number(config.shop.maxBuyPerCycle) || 0);
  config.shop.reserveSlots = Math.max(0, Number(config.shop.reserveSlots) || 0);
  if (!Array.isArray(config.shop.keep)) config.shop.keep = [];

  if (!config.farm.area || typeof config.farm.area !== 'object') config.farm.area = { x: 0, y: 64, z: 0, radius: 8 };
  for (const axis of ['x', 'y', 'z']) {
    if (config.farm.area[axis] !== null && config.farm.area[axis] !== undefined) {
      config.farm.area[axis] = Number(config.farm.area[axis]);
    }
  }
  config.farm.area.radius = Math.min(32, Math.max(1, Number(config.farm.area.radius) || 8));
  // Kotak lahan: min/max X dan Z, boleh jauh lebih lebar dari radius 32.
  if (config.farm.area.bounds && typeof config.farm.area.bounds === 'object' && !Array.isArray(config.farm.area.bounds)) {
    const bounds = config.farm.area.bounds;
    for (const key of ['minX', 'maxX', 'minZ', 'maxZ']) bounds[key] = Number(bounds[key]);
    if (![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every((value) => Number.isFinite(value))) {
      throw new Error('farm.area.bounds harus punya minX, maxX, minZ, maxZ (angka) untuk memanen lahan berbentuk kotak');
    }
    if (bounds.minX > bounds.maxX) [bounds.minX, bounds.maxX] = [bounds.maxX, bounds.minX];
    if (bounds.minZ > bounds.maxZ) [bounds.minZ, bounds.maxZ] = [bounds.maxZ, bounds.minZ];
    const sizeX = bounds.maxX - bounds.minX + 1;
    const sizeZ = bounds.maxZ - bounds.minZ + 1;
    if (sizeX > MAX_FARM_SPAN || sizeZ > MAX_FARM_SPAN) {
      throw new Error(`farm.area.bounds terlalu lebar (${sizeX}x${sizeZ} blok, maks ${MAX_FARM_SPAN} blok per sisi)`);
    }
  }
  if (!Array.isArray(config.farm.crops) || !config.farm.crops.length) config.farm.crops = ['carrots'];
  config.farm.scanIntervalMs = Math.max(2000, Number(config.farm.scanIntervalMs) || 15000);
  config.farm.harvestIntervalMs = Math.max(100, Number(config.farm.harvestIntervalMs) || 400);
  config.farm.maxPerCycle = Math.max(0, Number(config.farm.maxPerCycle) || 0);
  config.farm.scanHeight = Math.min(6, Math.max(1, Number(config.farm.scanHeight) || 2));
  config.farm.walkToRadius = Math.max(0, Number(config.farm.walkToRadius) || 0);
  config.farm.maxWalkDistance = Math.max(0, Number(config.farm.maxWalkDistance) || 0);
  config.farm.walkTimeoutMs = Math.max(1000, Number(config.farm.walkTimeoutMs) || 8000);
  config.farm.dropWaitMs = Math.max(0, Number(config.farm.dropWaitMs) || 0);
  config.farm.approachAttempts = Math.max(1, Number(config.farm.approachAttempts) || 12);
  config.farm.pickupAttempts = Math.max(1, Number(config.farm.pickupAttempts) || 14);
    // 0 = tanpa batas (default): panen terus sampai lahan habis atau di-stop
    const cropWalkSteps = Number(config.farm.cropWalkSteps);
    config.farm.cropWalkSteps = Number.isFinite(cropWalkSteps) && cropWalkSteps > 0
      ? Math.min(10000, Math.floor(cropWalkSteps))
      : 0;
    const chaseRange = Number(config.farm.chaseRange);
    config.farm.chaseRange = Number.isFinite(chaseRange) && chaseRange > 0
      ? Math.min(64, chaseRange)
      : 0;
    config.farm.pathRadius = Math.min(48, Math.max(4, Number(config.farm.pathRadius) || 24));
    config.farm.betweenCycleMs = Math.max(200, Number(config.farm.betweenCycleMs) || 600);
  config.farm.harvestCooldownMs = Math.max(0, Number(config.farm.harvestCooldownMs) || 0);
  config.farm.jumpCooldownMs = Math.max(500, Number(config.farm.jumpCooldownMs) || 1500);
  config.farm.jumpToClimb = config.farm.jumpToClimb === true;
  config.farm.sprint = config.farm.sprint === true;
  if (config.farm.enabled && ![config.farm.area.x, config.farm.area.y, config.farm.area.z].every((value) => Number.isFinite(value))) {
    throw new Error('farm.area harus punya x, y, dan z (angka) untuk memanen lahan');
  }
  if (typeof config.version === 'string' && config.version !== '' && !Number.isNaN(Number(config.version))) {
    config.version = Number(config.version);
  }
  if (!config.api || typeof config.api !== 'object') config.api = { ...DEFAULTS.api };
  config.api.enabled = config.api.enabled === true;
  config.api.host = String(config.api.host || DEFAULTS.api.host);
  config.api.port = Number(config.api.port) || DEFAULTS.api.port;
  config.api.token = config.api.token === null || config.api.token === undefined || config.api.token === ''
    ? null
    : String(config.api.token);
  config.api.logRequests = config.api.logRequests !== false;
  if (config.api.enabled && ['0.0.0.0', '::'].includes(config.api.host) && !config.api.token) {
    // Jangan sampai API terbuka ke publik tanpa token.
    throw new Error(
      'api.host=0.0.0.0 (terbuka ke semua interface) wajib diisi api.token - ' +
      'pakai env MC_API_TOKEN supaya tidak ikut ter-commit'
    );
  }
  if (config.api.enabled && !config.api.token) {
    throw new Error(
      'api.enabled=true butuh api.token (isi di config.json, atau set env MC_API_TOKEN) - ' +
      'API ini bisa menyalakan/mematikan bot jadi tidak boleh dibuka tanpa token'
    );
  }
  if (config.logging.file) {
    config.logging.file = path.resolve(__dirname, '..', config.logging.file);
  }
  if (!VALID_REGISTER_MODES.includes(config.register.mode)) {
    throw new Error(
      `register.mode "${config.register.mode}" tidak dikenal (pilihan: ${VALID_REGISTER_MODES.join(', ')})`
    );
  }
  if (config.register.password !== null && config.register.password !== undefined) {
    config.register.password = String(config.register.password);
  }
  for (const key of ['commandTemplate', 'loginTemplate']) {
    const value = config.register[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || !value.includes('{password}')) {
      throw new Error(
        `register.${key} harus string dan memuat "{password}", dapat: ${JSON.stringify(value)}`
      );
    }
  }

  return config;
}

module.exports = { loadConfig, mergeDeep, DEFAULTS, VALID_REGISTER_MODES };
