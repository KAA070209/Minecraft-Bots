'use strict';

const fs = require('fs');
const path = require('path');
const { mergeDeep, VALID_REGISTER_MODES } = require('./config');

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const VALID_AFK_MODES = new Set(['look', 'safe', 'wander']);

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

module.exports = { loadProfiles, validateProfile, USERNAME_PATTERN, VALID_AFK_MODES };
