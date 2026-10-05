'use strict';

const assert = require('assert');
const path = require('path');

const { DISCORD_COMMANDS, parseMessage, findCommand } = require('../commands');
const { formatResult, formatError, formatHelp, formatIdResult } = require('../format');
const { loadConfig, parseEnvFile, configErrors, configHints } = require('../config');
const { inviteUrl } = require('../index');

let checks = 0;
function check(label, condition, extra) {
  checks += 1;
  assert.ok(condition, `${label}${extra ? ` (${extra})` : ''}`);
}

function parse(text, context) {
  const parsed = parseMessage(text, '!');
  if (!parsed) return null;
  return { name: parsed.command ? parsed.command.name : null, args: parsed.args, line: parsed.command ? parsed.command.build(parsed.args, context) : null };
}

const KNOWN = { bots: ['jack01', 'jack02', 'AzkaSaadi'] };

const cases = [
  ['!attack jack01 on', 'attack', 'jack01 on', 'attack jack01 on'],
  ['!attack all off', 'attack', 'all off', 'attack all off'],
  ['!say jack01 halo dunia', 'say', 'jack01 halo dunia', 'say jack01 halo dunia'],
  ['!sayall halo', 'sayall', 'halo', 'say all halo'],
  ['!inv', 'inv', '', 'inv all'],
  ['!inv jack01 carrot', 'inv', 'jack01 carrot', 'inv jack01 carrot'],
  ['!inv carrot', 'inv', 'carrot', 'inv all carrot'],
  ['!invall carrot 5', 'invall', 'carrot 5', 'inv all carrot 5'],
  ['!harveststop', 'harveststop', '', 'harvest all stop'],
  ['!harveststop jack01', 'harveststop', 'jack01', 'harvest jack01 stop'],
  ['!farmon', 'farmon', '', 'farm all on'],
  ['!farmoff jack01', 'farmoff', 'jack01', 'farm jack01 off'],
  ['!walk jack01 forward 1500', 'walk', 'jack01 forward 1500', 'walk jack01 forward 1500'],
  ['!stop all', 'stop', 'all', 'stop all'],
  ['!shutdown jack01 confirm', 'shutdown', 'jack01 confirm', 'shutdown jack01 confirm']
];

for (const [text, name, args, line] of cases) {
  const parsed = parse(text, KNOWN);
  check(`parse ${text}`, parsed !== null);
  check(`command ${text} = ${name}`, parsed.name === name, parsed.name);
  check(`args ${text} = "${args}"`, parsed.args.join(' ') === args, parsed.args.join(' '));
  check(`line ${text} = "${line}"`, parsed.line === line, parsed.line);
}

check('nama bot dikenal dipakai sebagai target', parse('!inv AzkaSaadi', KNOWN).line === 'inv AzkaSaadi');
check('nama bot tidak dikenal jadi filter', parse('!inv Zombie', KNOWN).line === 'inv all Zombie');

check('prefix lain tidak diparse', parseMessage('attack jack01 on', '!') === null);
check('prefix kosong tidak diparse', parseMessage('   ', '!') === null);
check('perintah asing menghasilkan null command', parseMessage('!giphy bar', '!').command === null);
check('alias pukul = attack', findCommand('pukul').name === 'attack');
check('setiap perintah punya usage', DISCORD_COMMANDS.every((command) => command.usage.startsWith('!')));
check('setiap perintah punya build', DISCORD_COMMANDS.every((command) => typeof command.build === 'function'));
check('shutdown ditandai berbahaya', findCommand('shutdown').danger === true);

const okEmbed = formatResult(
  {
    ok: true,
    command: 'attack',
    targets: ['jack01'],
    results: [{ name: 'jack01', ok: true, lines: ['pukul mob ON', 'senjata    : pedang batu'] }]
  },
  { color: 1, errorColor: 2, maxLength: 1800 }
);
check('embed sukses hijau', okEmbed.color === 1);
check('embed sukses isi hasil', okEmbed.description.includes('pukul mob ON'));
check('embed sukses footer bot', okEmbed.footer.text.includes('jack01'));

const badEmbed = formatResult(
  {
    ok: false,
    command: 'status',
    targets: [],
    error: 'tidak ada bot yang bisa dikontrol',
    results: [{ name: '-', ok: false, lines: ['tidak ada bot yang bisa dikontrol'] }]
  },
  { color: 1, errorColor: 2, maxLength: 1800 }
);
check('embed gagal merah', badEmbed.color === 2);
check('embed gagal berisi error', badEmbed.description.includes('tidak ada bot'));

const longEmbed = formatResult(
  {
    ok: true,
    command: 'inv',
    targets: ['all'],
    results: Array.from({ length: 40 }, (unused, index) => ({
      name: `bot${index}`,
      ok: true,
      lines: [`baris ${index} ${'x'.repeat(80)}`]
    }))
  },
  { maxLength: 600 }
);
check('embed panjang dipotong', longEmbed.description.length <= 600, longEmbed.description.length);
check('embed panjang ada penanda potong', longEmbed.description.includes('dipotong'));

const helpEmbed = formatHelp(DISCORD_COMMANDS, { maxLength: 300 });
check('help embed berisi perintah pertama', helpEmbed.description.includes('!help'));
check('help embed dipotong', helpEmbed.description.length <= 300, helpEmbed.description.length);
check('help embed penuh memuat !attack', formatHelp(DISCORD_COMMANDS, { maxLength: 1800 }).description.includes('!attack'));

const clippedError = formatError('a'.repeat(5000), { maxLength: 500 });
check('formatError memotong teks', clippedError.description.length <= 500, clippedError.description.length);
check('formatError ada penanda potong', clippedError.description.endsWith('...'));
check('formatError hormati budget minimum', formatError('a'.repeat(5000), { maxLength: 10 }).description.length === 200);

const idAllowed = formatIdResult({ channelId: '999', guildId: '42', author: { id: '7' } }, { allowedChannels: ['999'] });
check('id embed menampilkan id channel', idAllowed.description.includes('999'));
check('id embed hijau saat diizinkan', idAllowed.color === 1 || idAllowed.color === 0x2ecc71, String(idAllowed.color));
check('id embed menandai diizinkan', idAllowed.description.includes('YA'));

const idDenied = formatIdResult({ channelId: '999', guildId: '42', author: { id: '7' } }, { allowedChannels: ['123'] });
check('id embed merah saat tidak diizinkan', idDenied.color === 2 || idDenied.color === 0xe74c3c, String(idDenied.color));
check('id embed menjelaskan diam', idDenied.description.includes('diam di channel ini'));
check('id embed menyarankan perbaikan', idDenied.description.includes('DISCORD_ALLOWED_CHANNELS'));

const idDm = formatIdResult({ channelId: '5', guildId: null, author: { id: '7' } }, { allowedChannels: [] });
check('id embed dm tanpa server', idDm.description.includes('DM'));

const invite = inviteUrl('1556707901924704468');
check('invite url pakai client id bot', invite.includes('client_id=1556707901924704468'));
check('invite url minta scope bot', invite.includes('scope=bot'));
check('invite url punya permission', /permissions=\d+/.test(invite), invite);

const idCommand = parseMessage('!dimana', '!');
check('alias !dimana ke id', idCommand.command && idCommand.command.name === 'id');
check('perintah id adalah diagnostic', idCommand.command.diagnostic === true);
check('diagnostic ada di daftar help', formatHelp(DISCORD_COMMANDS, { maxLength: 1800 }).description.includes('!id'));

const envFile = path.join(__dirname, '..', '.env.test-fixture');
require('fs').writeFileSync(
  envFile,
  '\uFEFFDISCORD_TOKEN=abc123\nMC_API_TOKEN=xyz\nexport DISCORD_ALLOWED_USERS="1, 2"\nDISCORD_ALLOWED_CHANNELS=" 4 , 5 "\n# komentar\n\nDISCORD_PREFIX=?\n'
);
const parsedEnv = parseEnvFile(envFile);
check('parseEnvFile baca token', parsedEnv.DISCORD_TOKEN === 'abc123');
check('parseEnvFile abaikan komentar', parsedEnv.PREFIX_SALAH === undefined);
check('parseEnvFile buang BOM', Object.prototype.hasOwnProperty.call(parsedEnv, 'DISCORD_TOKEN'));
check('parseEnvFile buang awalan export', parsedEnv.DISCORD_ALLOWED_CHANNELS === '4 , 5');
const fromFile = loadConfig({}, envFile);
check('loadConfig dari file', fromFile.discordToken === 'abc123' && fromFile.apiToken === 'xyz');
check('loadConfig prefix dari file', fromFile.prefix === '?');
check('loadConfig list user', fromFile.allowedUsers.join(',') === '1,2', fromFile.allowedUsers.join(','));
check('loadConfig list channel dari file', fromFile.allowedChannels.join(',') === '4,5', fromFile.allowedChannels.join(','));
check('loadConfig remembers envFile', fromFile.envFile === envFile);
check('loadCommand default prefix', loadConfig({}, path.join(__dirname, 'tidak-ada.env')).prefix === '!');
check('requireConfirm default false', loadConfig({}, path.join(__dirname, 'tidak-ada.env')).requireConfirm === false);

const missingFile = path.join(__dirname, 'tidak-ada.env');
check('configErrors sebut path file', configErrors(loadConfig({}, missingFile)).some((line) => line.includes(missingFile)));
check('configErrors ada petunjuk perbaikan', configHints().some((line) => line.includes('DISCORD_TOKEN')));
require('fs').unlinkSync(envFile);

process.stdout.write(`discord-bot: ${checks} test lolos\n`);