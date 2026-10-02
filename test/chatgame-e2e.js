'use strict';

const { loadProfiles } = require('../lib/profiles');
const { loadConfig, mergeDeep } = require('../lib/config');
const { createChatGameAgent } = require('../lib/chatgame');

const profile = loadProfiles('profiles.local.json').profiles.find((p) => p.name === 'AzkaSaadi');
const cfg = mergeDeep(loadConfig([], { MC_CONFIG: 'test/.tidak-ada.json' }), profile.config);
cfg.chatGame.storeFile = null;
cfg.chatGame.dedupeMs = 3000;
cfg.chatGame.minIntervalMs = 0;
cfg.chatGame.delayMs = 1;

const log = [];
const logger = {
  info: (m) => log.push('info  ' + m),
  warn: (m) => log.push('warn  ' + m),
  success: (m) => log.push('OK    ' + m)
};
const agent = createChatGameAgent({ config: cfg, logger, username: 'AzkaSaadi' });
const sent = [];
agent.start({ entity: {}, chat: (m) => sent.push(m) });

const Q1 = 'CHAT GAMES Guess the word: punya kelopak kuning, tinggi, berbau harum';
const Q2 = 'CHAT GAMES Guess the word: alat untuk memotong kertas';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ronde 1: dua soal baru -> belum ada jawabannya
  agent.handleChat(Q1);
  agent.handleChat('Nulled69 berhasil melengkapi katanya (3.5s)');
  agent.handleChat('Jawaban: Sunflower');
  agent.handleChat(Q2);
  await wait(60);
  console.log('ronde 1 chat:', JSON.stringify(sent));

  await wait(3000);
  // ronde 2: soal sama -> harus dijawab dari memory, soal Q2 -> masih miss
  agent.handleChat(Q1);
  agent.handleChat(Q2);
  await wait(60);
  console.log('ronde 2 chat:', JSON.stringify(sent));

  agent.handleChat('Jawaban: Gunting');
  await wait(3100);
  // ronde 3: Q2 sekarang punya jawaban -> harus dijawab
  agent.handleChat(Q2);
  await wait(60);
  console.log('ronde 3 chat:', JSON.stringify(sent));

  console.log('stats        :', JSON.stringify(agent.stats));
  console.log(log.join('\n'));
})();
