'use strict';

const { evaluate, extractExpression, solveMath, formatNumber } = require('../lib/solver');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass += 1;
  else fail += 1;
  process.stdout.write(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}

process.stdout.write('[solver] evaluate\n');
const mathCases = [
  ['2+3', 5], ['2 + 3 * 4', 14], ['(2+3)*4', 20], ['100/4', 25], ['2^3^2', 512],
  ['-5 + 3', -2], ['7 - -2', 9], ['10 % 3', 1], ['2.5 * 4', 10], ['sqrt(16)', 4],
  ['-3 * 4', -12], ['5 * -3', -15], ['100 - 25', 75], ['8/2*4', 16], ['-2^2', -4],
  ['abs(-7)', 7], ['1/0', null], ['1.2.3', null], ['', null], ['abc', null],
  ['(1+2', null], ['1+', null], ['+1', null], ['*3', null], ['()', null], ['5 5', null]
];
for (const [expr, want] of mathCases) {
  const got = evaluate(expr);
  check(`evaluate ${JSON.stringify(expr)} = ${want}`, got === want, `dapat ${got}`);
}

process.stdout.write('\n[solver] extractExpression\n');
const extractCases = [
  ['45 + 17 = ?', '45 + 17'],
  ['Berapa 12 x 8?', '12 * 8'],
  ['5\u00d7 9 - 3', '5 * 9 - 3'],
  ['hasil dari 100 : 5', '100 / 5'],
  ['level 10 bounty', null],
  ['kelopak kuning', null],
  ['8 + 8 - 3 + 2', '8 + 8 - 3 + 2'],
  ['1000 - 999', '1000 - 999'],
  ['jawab: 5', null]
];
for (const [text, want] of extractCases) {
  const got = extractExpression(text);
  check(`extract ${JSON.stringify(text)}`, got === want, `dapat ${JSON.stringify(got)}`);
}

process.stdout.write('\n[solver] solveMath\n');
check('45 + 17 -> 62', solveMath('45 + 17 = ?')?.answer === '62', JSON.stringify(solveMath('45 + 17 = ?')));
check('12 x 8 -> 96', solveMath('Berapa 12 x 8?')?.answer === '96');
check('100 : 5 -> 20', solveMath('hasil dari 100 : 5')?.answer === '20');
check('tanpa operator tidak dianggap soal', solveMath('level 10 bounty') === null);
check('kata mati tidak dianggap soal', solveMath('kelopak kuning') === null);
check('ekspresi tersimpan', solveMath('45 + 17 = ?')?.expression === '45 + 17');

process.stdout.write('\n[solver] formatNumber\n');
check('integer tanpa desimal', formatNumber(85) === '85', formatNumber(85));
check('pecahan dibulatkan', formatNumber(2.5) === '2.5', formatNumber(2.5));
check('sangat kecil tidak nol', formatNumber(1e-7) === '0', formatNumber(1e-7));

process.stdout.write('\n[solver] tidak mengeksekusi kode dari server\n');
check('require tidak dieksekusi', evaluate('require("fs")') === null);
check('panggilan fungsi tidak dieksekusi', evaluate('process.exit(1)') === null);
check('prototype pollution ditolak', evaluate('__proto__.x') === null);
check('template literal ditolak', evaluate('`x`') === null);

console.log(`\n[solver] ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
