'use strict';

// Daftar perintah yang dipahami HTTP control API milik mc-afk-bot.
//
// Repo ini berdiri sendiri: kalau foldernya dipisah dari repo mc-afk-bot,
// folder lib/ tidak ikut dan import dari sana berakhir MODULE_NOT_FOUND.
// Yang dipakai discord-bot cuma daftar nama perintah (untuk memvalidasi hasil
// mapping), bukan logika eksekusinya, jadi daftarnya dicatat di sini.
//
// Kalau mc-afk-bot menambah/mengubah perintah, salin daftar dari
// lib/control.js (field "name") ke sini supaya isKnownApiCommand() tetapsinkron.
const API_COMMAND_NAMES = [
  'help',
  'status',
  'pos',
  'stats',
  'look',
  'walk',
  'halts',
  'idle',
  'eat',
  'rescue',
  'attack',
  'buy',
  'dump',
  'inv',
  'harvest',
  'farm',
  'stop',
  'say',
  'solve',
  'restart',
  'shutdown'
];

module.exports = { API_COMMAND_NAMES };