'use strict';

// Membersihkan kunci hafalan yang rusak: pesan info server dan header kosong
// tidak boleh jadi kunci, karena bot akan "mengenali" pesan itu lalu
// mengulang jawaban basi ke chat.
const fs = require('fs');
const path = require('path');
const { DEFAULTS, isInformative } = require('../lib/chatgame');

const settings = { patterns: DEFAULTS.patterns, minResidueChars: DEFAULTS.minResidueChars };
const ignore = new RegExp(DEFAULTS.patterns.ignore, 'i');
const strip = (s) => String(s).replace(/[\uFFFD]/g, ' ');

const dir = path.join(__dirname, '..', 'logs');
let removed = 0;
let kept = 0;

for (const file of fs.readdirSync(dir).filter((f) => f.startsWith('chatgame-memory') && f.endsWith('.json'))) {
  const full = path.join(dir, file);
  const data = JSON.parse(fs.readFileSync(full, 'utf8'));
  const clean = {};
  for (const [key, answer] of Object.entries(data)) {
    const k = strip(key);
    const bad = ignore.test(k) || !isInformative(k, settings) || !String(answer || '').trim();
    if (bad) {
      console.log(`  hapus  ${file}: "${key.slice(0, 58)}" -> ${JSON.stringify(answer)}`);
      removed += 1;
    } else {
      clean[k] = answer;
      kept += 1;
    }
  }
  fs.writeFileSync(full, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
}

console.log(`\n${removed} kunci rusak dihapus, ${kept} entri sah dipertahankan.`);
