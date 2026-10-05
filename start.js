'use strict';

const fs = require('fs');
const path = require('path');

// Titik masuk default (npm start). Memilih mode secara otomatis supaya perintah
// yang sama bisa dipakai lokal maupun di Railway:
//
//   - MC_PROFILES_JSON ada, atau profiles.json/.local punya >1 profil  -> multi.js
//   - selain itu                                                            -> index.js
//
// Dipisah dari index.js/multi.js supaya logika pemilihan ini tidak bercampur
// dengan logika bot, dan supaya bisa diuji tanpa koneksi ke server Minecraft.

const ROOT = __dirname;
const PROFILE_FILES = ['profiles.json', 'profiles.local.json'];

function countProfiles(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : parsed.profiles;
    if (!Array.isArray(list)) return 0;
    return list.filter((profile) => profile && profile.enabled !== false).length;
  } catch {
    return 0;
  }
}

function chooseTarget(options = {}) {
  const env = options.env || process.env;
  const cwd = options.root || ROOT;

  if (env.MC_MODE) return env.MC_MODE === 'single' ? 'index.js' : 'multi.js';

  // Di Railway profil hanya ada di env, tidak ada file. Kalau env itu diisi,
  // intent-nya sudah jelas multi-bot walau hanya satu profil: orkestrator yang
  // menyalakan HTTP control API, bukan mode satu-bot.
  if (env.MC_PROFILES_JSON || env.PROFILES_JSON) return 'multi.js';

  for (const name of PROFILE_FILES) {
    const file = path.join(cwd, name);
    if (fs.existsSync(file) && countProfiles(file) > 1) return 'multi.js';
  }

  return 'index.js';
}

if (require.main === module) {
  const target = chooseTarget();
  process.stdout.write(`start: mode ${target === 'multi.js' ? 'multi-bot' : 'satu-bot'} (${target})\n`);
  // main() dipanggil eksplisit: check require.main di index.js/multi.js sudah
  // false di sini karena file yang jadi entrypoint adalah start.js.
  require(path.join(ROOT, target)).main();
}

module.exports = { chooseTarget, countProfiles, PROFILE_FILES };