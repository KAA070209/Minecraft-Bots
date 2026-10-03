'use strict';

const DEFAULT_SLOTS = 36;
const HOTBAR_START = 9;
const HOTBAR_END = 17;
const MAX_ROWS = 20;
const LABEL_WIDTH = 24;

function stripColor(text) {
  return String(text == null ? '' : text).replace(/\u00a7[0-9a-fk-or]/gi, '').trim();
}

function prettyName(name) {
  if (!name) return 'unknown';
  const text = stripColor(name).replace(/_/g, ' ');
  return text || 'unknown';
}

function itemLabel(item) {
  if (!item) return '-';
  const named = item.customName || item.displayName;
  if (named) {
    const text = stripColor(named);
    if (text) return text;
  }
  return prettyName(item.name);
}

function describeItem(item) {
  if (!item) return null;
  const slot = Number(item.slot);
  return {
    slot: Number.isFinite(slot) ? slot : null,
    name: item.name ? String(item.name) : 'unknown',
    label: itemLabel(item),
    count: Math.max(0, Number(item.count) || 0),
    type: item.type === undefined ? null : item.type
  };
}

function inHotbar(slot) {
  return slot !== null && slot >= HOTBAR_START && slot <= HOTBAR_END;
}

function sortBySlot(items) {
  return items.slice().sort((a, b) => {
    const left = a.slot === null ? Number.MAX_SAFE_INTEGER : a.slot;
    const right = b.slot === null ? Number.MAX_SAFE_INTEGER : b.slot;
    return left - right;
  });
}

function readInventory(bot, options = {}) {
  const total = Math.max(1, Number(options.slots) || DEFAULT_SLOTS);
  const source = bot && bot.inventory && typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];
  const items = sortBySlot(source.map(describeItem).filter(Boolean));
  const selected = Number(bot && bot.quickBarSlot);
  const quickSlot = Number.isFinite(selected) ? selected + HOTBAR_START : null;
  const held = describeItem(bot && bot.heldItem) || items.find((item) => item.slot === quickSlot) || null;
  return {
    total,
    used: items.length,
    free: Math.max(0, total - items.length),
    stacks: items.length,
    amount: items.reduce((sum, item) => sum + item.count, 0),
    items,
    held,
    selectedSlot: quickSlot
  };
}

function matchesItem(item, query) {
  if (!item) return false;
  if (!query) return true;
  const needle = String(query).toLowerCase();
  return item.name.toLowerCase().includes(needle) || item.label.toLowerCase().includes(needle);
}

function searchItems(items, query) {
  const source = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!query) return source.slice();
  return source.filter((item) => matchesItem(item, query));
}

function slotColumn(slot) {
  return (slot === null || slot === undefined ? '-' : String(slot)).padStart(2, ' ');
}

function formatInventory(snapshot, options = {}) {
  const query = String(options.query || '').trim();
  const items = searchItems(snapshot.items, query);
  const limit = Math.max(1, Number(options.limit) || MAX_ROWS);
  const shown = items.slice(0, limit);
  const heldSlot = snapshot.held ? snapshot.held.slot : null;
  const lines = [
    `slot     : ${snapshot.used}/${snapshot.total} terpakai, sisa ${snapshot.free}`,
    `total    : ${snapshot.stacks} tumpukan / ${snapshot.amount} item`,
    `tangan   : ${snapshot.held ? `${snapshot.held.label} x${snapshot.held.count}` : 'kosong'}`
  ];
  if (query) {
    const matches = items.reduce((sum, item) => sum + item.count, 0);
    lines.push(`filter   : "${query}" -> ${items.length} tumpukan / ${matches} item`);
  }
  if (!items.length) {
    lines.push(query ? 'tidak ada item yang cocok' : 'inventory kosong');
    return { lines, items, shown: 0, hidden: 0 };
  }
  for (const item of shown) {
    const tags = [];
    if (inHotbar(item.slot)) tags.push('hotbar');
    if (heldSlot !== null && item.slot === heldSlot) tags.push('tangan');
    lines.push(
      `  ${slotColumn(item.slot)}  ${item.label.padEnd(LABEL_WIDTH).slice(0, LABEL_WIDTH)} ` +
      `x${String(item.count).padStart(3, ' ')}${tags.length ? `  ${tags.join(', ')}` : ''}`
    );
  }
  const hidden = items.length - shown.length;
  if (hidden > 0) lines.push(`  ... ${hidden} tumpukan lain (tambah max baris atau pakai filter)`);
  return { lines, items, shown: shown.length, hidden };
}

function inventoryReport(bot, options = {}) {
  const snapshot = readInventory(bot, options);
  const report = formatInventory(snapshot, options);
  return { snapshot, query: String(options.query || '').trim(), ...report };
}

module.exports = {
  readInventory,
  describeItem,
  itemLabel,
  prettyName,
  stripColor,
  searchItems,
  matchesItem,
  formatInventory,
  inventoryReport,
  slotColumn,
  inHotbar,
  DEFAULT_SLOTS,
  MAX_ROWS
};