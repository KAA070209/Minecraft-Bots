'use strict';

const fs = require('fs');
const path = require('path');

const API_URL_KEYS = ['MC_API_URL', 'API_URL'];
const API_TOKEN_KEYS = ['MC_API_TOKEN', 'API_TOKEN'];

// Semua kunci yang boleh diisi lewat environment variable. Kalau salah satunya
// ada di environment, file .env tidak diperlukan sama sekali.
const CONFIG_KEYS = [
  ...new Set([
    'DISCORD_TOKEN',
    'DISCORD_BOT_TOKEN',
    ...API_URL_KEYS,
    ...API_TOKEN_KEYS,
    'DISCORD_PREFIX',
    'DISCORD_ALLOWED_USERS',
    'DISCORD_ALLOWED_ROLES',
    'DISCORD_ALLOWED_CHANNELS',
    'DISCORD_ALLOWED_GUILDS',
    'DISCORD_REQUIRE_CONFIRM',
    'MC_API_TIMEOUT_MS',
    'DISCORD_MAX_LENGTH',
    'DISCORD_COLOR',
    'DISCORD_COLOR_ERROR'
  ])
];

// .env dibaca relatif ke folder service ini, bukan ke folder kerja, supaya tetap
// ketemu walau dijalankan dari folder lain (mis. dari root repo).
const DEFAULT_ENV_FILE = path.join(__dirname, '.env');

function parseEnvFile(file) {
  if (!file || !fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    // BOM di awal file (PowerShell "Set-Content -Encoding utf8" menulisnya) dan
    // awalan "export " tidak boleh ikut jadi bagian nama kunci.
    const line = raw.replace(/^\uFEFF/, '').trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim();
    }
    if (key) out[key] = value;
  }
  return out;
}

function loadConfig(env = process.env, file = env.MC_ENV_FILE || DEFAULT_ENV_FILE) {
  const fileEnv = parseEnvFile(file);
  const get = (keys, fallback = null) => {
    for (const key of keys) {
      const value = env[key] !== undefined ? env[key] : fileEnv[key];
      if (value !== undefined && String(value).trim() !== '') return String(value).trim();
    }
    return fallback;
  };

  const list = (keys, fallback = []) => {
    const raw = get(keys, null);
    if (!raw) return fallback;
    return raw
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  };

  return {
    envFile: file,
    envFileExists: fs.existsSync(file),
    // Kunci yang datang dari environment asli, bukan dari file .env. dipakai
    // untuk membedakan "config salah" dari "file .env memang tidak perlu ada".
    envKeys: Object.keys(fileEnv),
    fromEnvironment: CONFIG_KEYS.filter((key) => env[key] !== undefined && String(env[key]).trim() !== ''),
    discordToken: get(['DISCORD_TOKEN', 'DISCORD_BOT_TOKEN'], null),
    apiUrl: get(API_URL_KEYS, 'http://127.0.0.1:8787').replace(/\/+$/, ''),
    apiToken: get(API_TOKEN_KEYS, null),
    prefix: get(['DISCORD_PREFIX'], '!'),
    allowedUsers: list(['DISCORD_ALLOWED_USERS']),
    allowedRoles: list(['DISCORD_ALLOWED_ROLES']),
    allowedChannels: list(['DISCORD_ALLOWED_CHANNELS']),
    allowedGuilds: list(['DISCORD_ALLOWED_GUILDS']),
    timeoutMs: Number(get(['MC_API_TIMEOUT_MS'], '20000')) || 20000,
    requireConfirm: ['1', 'true', 'yes', 'on'].includes(String(get(['DISCORD_REQUIRE_CONFIRM'], 'false')).toLowerCase()),
    color: Number(get(['DISCORD_COLOR'], '0x2ecc71')) || 0x2ecc71,
    colorError: Number(get(['DISCORD_COLOR_ERROR'], '0xe74c3c')) || 0xe74c3c,
    maxLength: Number(get(['DISCORD_MAX_LENGTH'], '1800')) || 1800
  };
}

function configErrors(config) {
  const errors = [];
  const file = config.envFile || DEFAULT_ENV_FILE;
  const fromEnv = config.fromEnvironment || [];
  const suppliedByEnv = fromEnv.length > 0;
  // Di Railway/heroku tidak ada file .env sama sekali: semua config datang dari
  // environment variable. Menolak start hanya karena file itu tidak ada akan
  // menggagalkan deploy yang sebenarnya sudah benar.
  if (!config.envFileExists && !suppliedByEnv) {
    errors.push(`file ${file} tidak ada dan tidak ada config di environment variable`);
  }
  const source = suppliedByEnv ? 'environment variable' : file;
  if (!config.discordToken) {
    errors.push(
      `DISCORD_TOKEN belum diisi di ${source}` +
      `${config.envKeys && config.envKeys.length && !suppliedByEnv ? ` (kunci yang terbaca dari file: ${config.envKeys.join(', ')})` : ''}` +
      ' - token ada di Developer Portal -> tab "Bot" -> Reset Token'
    );
  }
  if (!config.apiToken) {
    errors.push(`MC_API_TOKEN belum diisi di ${source} (harus sama dengan MC_API_TOKEN di service bot Minecraft)`);
  }
  return errors;
}

function configHints() {
  return [
    '',
    'di Railway/heroku, isi semua ini sebagai environment variable di dashboard',
    '(file .env tidak perlu ada di sana):',
    '  DISCORD_TOKEN, MC_API_TOKEN, MC_API_URL',
    '',
    'secara lokal, cara paling cepat tanpa edit file:',
    '  $env:DISCORD_TOKEN = "token-bot-discord"   # PowerShell',
    '  export DISCORD_TOKEN=token-bot-discord     # Linux',
    '  npm start',
    '',
    'atau isi DISCORD_TOKEN di .env lalu simpan, lalu cek dengan:',
    '  Get-Content .env -TotalCount 1'
  ];
}

module.exports = { loadConfig, configErrors, configHints, parseEnvFile, DEFAULT_ENV_FILE };