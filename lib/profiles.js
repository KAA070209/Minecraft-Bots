'use strict';

const fs = require('fs');
const path = require('path');
const { mergeDeep, VALID_REGISTER_MODES } = require('./config');

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const VALID_AFK_MODES = new Set(['look', 'safe', 'wander']);
const VALID_SHOP_MODES = new Set(['gui', 'command']);

function validateSection(profile, errors, label, key, extra) {
  const value = profile[key];
  if (value === undefined) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${label}: "${key}" harus berupa objek`);
    return;
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    errors.push(`${label}: ${key}.enabled harus boolean`);
  }
  if (extra) extra(value, errors, label);
}

function validateProfile(profile, index) {
  const label = profile && profile.name ? profile.name : `profiles[${index}]`;
  const errors = [];

  if (!profile || typeof profile !== 'object') {
    errors.push(`${label}: harus berupa objek`);
    return errors;
  }
  if (!profile.name) {
    errors.push(`${label}: field "name" wajib diisi`);
  } else if (!USERNAME_PATTERN.test(profile.name)) {
    errors.push(`${label}: nama "${profile.name}" tidak valid (harus 3-16 karakter, hanya A-Z a-z 0-9 _)`);
  }
  if (profile.password !== undefined && profile.password !== null && typeof profile.password !== 'string') {
    errors.push(`${label}: "password" harus string atau null`);
  }
  if (profile.password && profile.name && profile.password.toLowerCase().includes(String(profile.name).toLowerCase())) {
    errors.push(
      `${label}: password "${profile.password}" memuat nickname "${profile.name}" ` +
      '— server akan menolak ("A password cannot contain your nickname!")'
    );
  }
  if (profile.register !== undefined && (typeof profile.register !== 'object' || profile.register === null)) {
    errors.push(`${label}: "register" harus berupa objek`);
  } else if (profile.register && profile.register.mode && !VALID_REGISTER_MODES.includes(profile.register.mode)) {
    errors.push(`${label}: register.mode "${profile.register.mode}" tidak dikenal (pilihan: ${VALID_REGISTER_MODES.join(', ')})`);
  }
  if (profile.chatGame !== undefined && (typeof profile.chatGame !== 'object' || profile.chatGame === null || Array.isArray(profile.chatGame))) {
    errors.push(`${label}: "chatGame" harus berupa objek`);
  } else if (profile.chatGame) {
    const cg = profile.chatGame;
    if (cg.enabled !== undefined && typeof cg.enabled !== 'boolean') {
      errors.push(`${label}: chatGame.enabled harus boolean`);
    }
    if (cg.fuzzyThreshold !== undefined) {
      const value = Number(cg.fuzzyThreshold);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        errors.push(`${label}: chatGame.fuzzyThreshold harus angka 0-1 (terima "${cg.fuzzyThreshold}")`);
      }
    }
    if (cg.api && typeof cg.api === 'object') {
      if (cg.api.enabled && !(cg.api.endpoint && cg.api.apiKey)) {
        errors.push(`${label}: chatGame.api.enabled=true butuh "endpoint" dan "apiKey"`);
      }
    } else if (cg.api !== undefined) {
      errors.push(`${label}: chatGame.api harus berupa objek`);
    }
  }
  if (profile.overrides !== undefined && (typeof profile.overrides !== 'object' || profile.overrides === null)) {
    errors.push(`${label}: "overrides" harus berupa objek`);
  }
  if (profile.overrides && profile.overrides.afk && profile.overrides.afk.mode) {
    if (!VALID_AFK_MODES.has(profile.overrides.afk.mode)) {
      errors.push(`${label}: afk.mode "${profile.overrides.afk.mode}" tidak dikenal (pilihan: ${[...VALID_AFK_MODES].join(', ')})`);
    }
  }

  validateSection(profile, errors, label, 'combat', (combat, list) => {
    if (combat.range !== undefined && !(Number(combat.range) > 0)) {
      list.push(`${label}: combat.range harus angka lebih dari 0`);
    }
    if (combat.attackPlayers !== undefined && typeof combat.attackPlayers !== 'boolean') {
      list.push(`${label}: combat.attackPlayers harus boolean`);
    }
    if (combat.approach !== undefined && typeof combat.approach !== 'boolean') {
      list.push(`${label}: combat.approach harus boolean (false = jangan dekati, pukul dari tempat)`);
    }
    if (combat.whitelist !== undefined && !Array.isArray(combat.whitelist)) {
      list.push(`${label}: combat.whitelist harus berupa array nama mob`);
    }
    for (const key of ['cpsMin', 'cpsMax']) {
      if (combat[key] === undefined || combat[key] === null) continue;
      if (!(Number(combat[key]) > 0)) {
        list.push(`${label}: combat.${key} harus angka > 0 (klik per detik) atau null untuk click rate tetap`);
      }
    }
  });

  validateSection(profile, errors, label, 'shop', (shop, list) => {
    if (shop.mode !== undefined && !VALID_SHOP_MODES.has(shop.mode)) {
      list.push(`${label}: shop.mode "${shop.mode}" tidak dikenal (pilihan: ${[...VALID_SHOP_MODES].join(', ')})`);
    }
    if (shop.items !== undefined && (!Array.isArray(shop.items) || shop.items.some((name) => typeof name !== 'string'))) {
      list.push(`${label}: shop.items harus berupa array nama item (string)`);
    }
    if (shop.command !== undefined && typeof shop.command !== 'string') {
      list.push(`${label}: shop.command harus string (contoh "/shop")`);
    }
  });

  validateSection(profile, errors, label, 'farm', (farm, list) => {
    if (farm.area !== undefined && (typeof farm.area !== 'object' || farm.area === null || Array.isArray(farm.area))) {
      list.push(`${label}: farm.area harus berupa objek {x, y, z, radius}`);
      return;
    }
    if (farm.enabled === true && farm.area) {
      for (const axis of ['x', 'y', 'z']) {
        if (!Number.isFinite(Number(farm.area[axis]))) {
          list.push(`${label}: farm.area.${axis} wajib diisi angka saat farm.enabled=true`);
        }
      }
    }
    if (farm.crops !== undefined && (!Array.isArray(farm.crops) || farm.crops.some((name) => typeof name !== 'string'))) {
      list.push(`${label}: farm.crops harus berupa array nama tanaman (contoh ["carrots"] atau ["carrot"])`);
    }
  });

  return errors;
}

function loadProfiles(file) {
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`file profil tidak ditemukan: ${filePath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`file profil bukan JSON yang valid: ${err.message}`);
  }

  const rawProfiles = Array.isArray(parsed) ? parsed : parsed.profiles;
  if (!Array.isArray(rawProfiles) || rawProfiles.length === 0) {
    throw new Error('file profil harus berisi array "profiles" yang tidak kosong');
  }

  const defaults = (Array.isArray(parsed) ? {} : parsed.defaults) || {};
  const errors = [];
  const seen = new Set();

  const profiles = rawProfiles.map((raw, index) => {
    errors.push(...validateProfile(raw, index));
    if (!raw || !raw.name) return null;
    if (seen.has(raw.name)) {
      errors.push(`${raw.name}: nama profil duplikat`);
      return null;
    }
    seen.add(raw.name);

    const perProfile = {};
    if (raw.register && typeof raw.register === 'object') perProfile.register = raw.register;
    if (raw.chatGame && typeof raw.chatGame === 'object') perProfile.chatGame = raw.chatGame;
    for (const key of ['combat', 'shop', 'farm']) {
      if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) perProfile[key] = raw[key];
    }
    if (raw.overrides && typeof raw.overrides === 'object') Object.assign(perProfile, raw.overrides);

    const merged = mergeDeep(defaults, perProfile);
    delete merged.name;
    delete merged.enabled;

    const register = { ...(merged.register || {}) };
    if (raw.password !== undefined && raw.password !== null) register.password = String(raw.password);
    else if (raw.register && raw.register.password) register.password = String(raw.register.password);
    merged.register = { ...register, password: register.password ?? null };
    merged.account = { ...(merged.account || {}), username: raw.name };

    return {
      name: raw.name,
      enabled: raw.enabled !== false,
      password: merged.register.password,
      config: merged
    };
  }).filter(Boolean);

  if (errors.length) {
    throw new Error(`file profil tidak valid:\n  - ${errors.join('\n  - ')}`);
  }

  return { profiles, defaults, filePath };
}

module.exports = { loadProfiles, validateProfile, USERNAME_PATTERN, VALID_AFK_MODES, VALID_SHOP_MODES };
