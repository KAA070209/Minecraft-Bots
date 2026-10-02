'use strict';

// Parser ekspresi aritmetika tanpa eval(): teks dari server tidak pernah
// dieksekusi sebagai kode.
const BINARY = {
  '+': { prec: 1 },
  '-': { prec: 1 },
  '*': { prec: 2 },
  '/': { prec: 2 },
  '%': { prec: 2 },
  '^': { prec: 3 }
};
const FN = {
  'sqrt': Math.sqrt,
  'abs': Math.abs,
  'round': Math.round,
  'floor': Math.floor,
  'ceil': Math.ceil
};
const FN_MARK = 'fn';
const NEG_MARK = 'neg';

function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] || ''))) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j += 1;
      const raw = input.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) return null;
      if (!Number.isFinite(Number(raw))) return null;
      tokens.push({ type: 'num', value: Number(raw) });
      i = j;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(BINARY, ch)) { tokens.push({ type: 'op', value: ch }); i += 1; continue; }
    if (ch === '(' || ch === '[') { tokens.push({ type: 'open', value: ch }); i += 1; continue; }
    if (ch === ')' || ch === ']') { tokens.push({ type: 'close', value: ch }); i += 1; continue; }
    const rest = input.slice(i).toLowerCase();
    const name = Object.keys(FN).find((fn) => rest.startsWith(fn));
    if (name) { tokens.push({ type: 'fn', value: name }); i += name.length; continue; }
    return null;
  }
  return tokens;
}

function applyBinary(op, a, b) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? NaN : a / b;
    case '%': return b === 0 ? NaN : a % b;
    case '^': return a ** b;
    default: return NaN;
  }
}

function evaluate(input) {
  const tokens = tokenize(input);
  if (!tokens || !tokens.length) return null;

  const out = [];
  const ops = [];
  let prevType = null;

  const reduceBinary = () => {
    const op = ops.pop();
    if (!op || op === '(' || op === '[' || op === FN_MARK || op === NEG_MARK) return false;
    const b = out.pop();
    const a = out.pop();
    if (a === undefined || b === undefined) return false;
    const value = applyBinary(op, a, b);
    if (!Number.isFinite(value)) return false;
    out.push(value);
    return true;
  };

  const applyFn = () => {
    if (ops[ops.length - 1] !== FN_MARK) return true;
    ops.pop();
    const a = out.pop();
    if (a === undefined) return false;
    const name = ops.pop();
    if (!name || !Object.prototype.hasOwnProperty.call(FN, name)) return false;
    const value = FN[name](a);
    if (!Number.isFinite(value)) return false;
    out.push(value);
    return true;
  };

  const applyNeg = () => {
    if (ops[ops.length - 1] !== NEG_MARK) return true;
    ops.pop();
    const a = out.pop();
    if (a === undefined) return false;
    out.push(-a);
    return true;
  };

  for (const token of tokens) {
    if (token.type === 'num') {
      out.push(token.value);
      prevType = 'num';
      continue;
    }
    if (token.type === 'fn') {
      ops.push(token.value);
      ops.push(FN_MARK);
      prevType = 'op';
      continue;
    }
    if (token.type === 'op') {
      if (prevType !== 'num' && prevType !== 'close') {
        if (token.value !== '-') return null;
        ops.push(NEG_MARK);
      } else {
        while (ops.length) {
          const top = ops[ops.length - 1];
          if (top === '(' || top === '[') break;
          if (top === FN_MARK) { if (!applyFn()) return null; continue; }
          if (top === NEG_MARK) {
            if (token.value === '^') break;
            if (!applyNeg()) return null;
            continue;
          }
          const topPrec = BINARY[top].prec;
          if (topPrec > BINARY[token.value].prec
            || (topPrec === BINARY[token.value].prec && token.value !== '^')) {
            if (!reduceBinary()) return null;
          } else break;
        }
        ops.push(token.value);
      }
      prevType = 'op';
      continue;
    }
    if (token.type === 'open') {
      ops.push(token.value);
      prevType = 'op';
      continue;
    }
    if (token.type === 'close') {
      while (ops.length && ops[ops.length - 1] !== '(' && ops[ops.length - 1] !== '[') {
        if (ops[ops.length - 1] === FN_MARK) { if (!applyFn()) return null; continue; }
        if (ops[ops.length - 1] === NEG_MARK) { if (!applyNeg()) return null; continue; }
        if (!reduceBinary()) return null;
      }
      if (!ops.length) return null;
      ops.pop();
      if (!applyFn()) return null;
      if (!applyNeg()) return null;
      prevType = 'close';
      continue;
    }
  }

  while (ops.length) {
    const top = ops[ops.length - 1];
    if (top === '(' || top === '[') return null;
    if (top === FN_MARK) { if (!applyFn()) return null; continue; }
    if (top === NEG_MARK) { if (!applyNeg()) return null; continue; }
    if (!reduceBinary()) return null;
  }
  if (out.length !== 1) return null;
  return Number.isFinite(out[0]) ? out[0] : null;
}

const NOISE = /(?:berapa|hasil|jawab(?:an)?|nilai|result|answer|total|tentukan|hitung(?:an)?)\b/gi;

// Ambil ekspresi aritmetika dari teks soal.
const ID_WORDS = [
  [/\b(dikali|perkalian|multiplied|times)\b/gi, ' * '],
  [/\b(dibagi|pembagian|divided)\b/gi, ' / '],
  [/\b(tambah|ditambah|penjumlahan|menjumlahkan|added)\b/gi, ' + '],
  [/\b(kurang|dikurangi|pengurangan|mengurangi|subtracted)\b/gi, ' - '],
  [/\b(pangkat|pangkatkan|power)\b/gi, ' ^ '],
  [/\b(kali|banyaknya)\b/gi, ' * ']
];
const IGNORE_WORDS = new Set(['dan', 'dengan', 'sama', 'pada', 'adalah', 'itu', 'ini', 'per', 'atau', 'a', 'b']);

// Ekstrak ekspresi aritmetika dari teks soal (Indonesia/Inggris).
function extractExpression(text) {
  const raw = String(text || '');
  // "45 + 17 = 62" berarti jawaban sudah ditampilkan, jangan dijawab lagi.
  if (/[=＝]\s*-?\d/.test(raw)) return null;

  let cleaned = raw
    .replace(/\u00d7/g, '*')
    .replace(/\u00f7/g, '/')
    .replace(/\u2212/g, '-');
  for (const [pattern, replacement] of ID_WORDS) cleaned = cleaned.replace(pattern, replacement);
  cleaned = cleaned
    .replace(NOISE, ' ')
    .replace(/([\d)])\s*[xX]\s*(?=\d)/g, '$1 * ')
    .replace(/([\d)])\s*:\s*(?=\d)/g, '$1 / ')
    .replace(/[?=]/g, ' ')
    .replace(/([+\-*/%^()])/g, ' $1 ')
    .replace(/[^0-9+\-*/%^()\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/\d/.test(cleaned)) return null;

  const kept = [];
  for (const token of cleaned.split(' ').filter(Boolean)) {
    if (/^\d[\d.]*$/.test(token)) { kept.push(token); continue; }
    if (IGNORE_WORDS.has(token.toLowerCase())) continue;
    if (/^[+\-*/%^()]$/.test(token)) { kept.push(token); continue; }
    return null;
  }
  const expr = kept.join(' ').trim();
  // Butuh minimal satu operator: angka sendirian bukan soal hitungan.
  if (!/\d/.test(expr)) return null;
  if (!/[+\-*/%^()]/.test(expr.replace(/^\s*-\s*/, ''))) return null;
  return expr;
}

function formatNumber(value) {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1e6) / 1e6);
}

function solveMath(text) {
  const expr = extractExpression(text);
  if (!expr) return null;
  const value = evaluate(expr);
  if (value === null) return null;
  return { expression: expr, answer: formatNumber(value) };
}

module.exports = { evaluate, extractExpression, solveMath, formatNumber };
