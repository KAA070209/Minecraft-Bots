'use strict';

const fs = require('fs');
const path = require('path');

const VALID_REGISTER_MODES = ['off', 'auto', 'login', 'register'];

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
  reconnect: { baseMs: 6000, maxMs: 180000, factor: 1.8, jitter: 0.3, maxAttempts: 0, afkKickExtraMs: 90000 },
  logging: { level: 'info', file: './logs/afk-bot.log', color: true, logChat: true, maxLogFileBytes: 5242880 },
  console: { enabled: true, commandPrefix: '!' }
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
  if (env.MC_LOG_LEVEL) out.logging = { level: env.MC_LOG_LEVEL };
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
  return out;
}

function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const configPath = env.MC_CONFIG ? path.resolve(env.MC_CONFIG) : path.join(__dirname, '..', 'config.json');
  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  if (env.MC_CONFIG_JSON) {
    try {
      fileConfig = mergeDeep(fileConfig, JSON.parse(env.MC_CONFIG_JSON));
    } catch (err) {
      process.stderr.write(`MC_CONFIG_JSON tidak bisa di-parse, diabaikan: ${err.message}\n`);
    }
  }

  const args = parseArgs(argv);
  const argsConfig = fromArgs(args);
  const envConfig = fromEnv(env);

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
  if (typeof config.version === 'string' && config.version !== '' && !Number.isNaN(Number(config.version))) {
    config.version = Number(config.version);
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
