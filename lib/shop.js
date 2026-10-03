'use strict';

const PRICE_PATTERNS = [
  /(?:harga|price|cost|biaya|buy\s*for|beli)\s*[:=]?\s*\$?\s*([\d.,]+)/i,
  /\$\s*([\d.,]+)/,
  /([\d.,]+)\s*(?:koin|coin|uang|money|rp|idr|\$)/i
];

const DEFAULT_KEEP = ['shield', 'elytra', 'totem_of_undying'];

function toNumber(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/\s/g, '').replace(/,/g, '.').replace(/\.(?=\d{3}\b)/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parsePrice(text) {
  if (!text) return null;
  const value = String(text);
  for (const pattern of PRICE_PATTERNS) {
    const match = value.match(pattern);
    if (!match) continue;
    const parsed = toNumber(match[1]);
    if (parsed !== null && parsed >= 0) return parsed;
  }
  return null;
}

function itemLines(item) {
  const lines = [];
  if (!item) return lines;
  if (item.customName) lines.push(String(item.customName));
  if (item.customLore) lines.push(...item.customLore.map((line) => String(line)));
  if (item.displayName) lines.push(String(item.displayName));
  if (item.nbt) {
    const raw = JSON.stringify(item.nbt);
    const lore = raw.match(/"(?:Lore|lore)":"(.*?)"/);
    if (lore) lines.push(lore[1].replace(/\\u00a7./g, ''));
  }
  return lines;
}

function slotItem(slot) {
  if (!slot) return null;
  return slot.nbt && typeof slot.nbt.getItem === 'function' ? slot.nbt.getItem() : (slot.item || slot);
}

function freeSlots(bot, options = {}) {
  const size = Number(options.inventorySlots) || 36;
  const used = bot && bot.inventory && typeof bot.inventory.items === 'function' ? bot.inventory.items().length : 0;
  const reserve = Math.max(0, Number(options.reserveSlots) || 0);
  return Math.max(0, size - used - reserve);
}

function isInventoryFull(bot, options = {}) {
  return freeSlots(bot, options) <= 0;
}

function stacksNeeded(name, amount) {
  const perStack = 64;
  return Math.max(1, Math.ceil((Number(amount) || 0) / perStack));
}

function planDump(bot, config = {}) {
  const keep = new Set((config.keep || DEFAULT_KEEP).map(String));
  const drop = [];
  if (!bot || !bot.inventory || typeof bot.inventory.items !== 'function') return { drop, kept: [], reason: 'inventory kosong' };
  for (const item of bot.inventory.items()) {
    if (!item || keep.has(String(item.name))) continue;
    drop.push({ name: item.name, count: item.count });
  }
  return { drop, kept: [...keep], reason: drop.length ? 'inventory penuh, buang isi' : 'tidak ada yang perlu dibuang' };
}

async function dumpInventory(bot, config = {}, logger) {
  const log = logger || { debug() {}, info() {}, warn() {}, success() {} };
  const plan = planDump(bot, config);
  if (!plan.drop.length) return { dropped: 0, kept: plan.kept };
  let dropped = 0;
  for (const entry of plan.drop) {
    const item = bot.inventory.items().find((candidate) => candidate && candidate.name === entry.name);
    if (!item) continue;
    try {
      await bot.toss(item.type, null, item.count);
      dropped += 1;
      log.info(`buang ${entry.name} x${entry.count} (inventory penuh)`);
    } catch (err) {
      log.debug(`gagal buang ${entry.name}: ${err.message}`);
    }
  }
  log.success(`buang ${dropped} tumpukan dari inventory`);
  return { dropped, kept: plan.kept };
}

function findBuyableSlots(window, config = {}) {
  const wanted = new Set((config.items || []).map((name) => String(name).toLowerCase()));
  const slots = (window && window.slots) || [];
  const found = [];
  slots.forEach((slot, index) => {
    const item = slotItem(slot);
    if (!item || !item.name) return;
    const name = String(item.name).toLowerCase();
    if (!wanted.has(name)) return;
    const amount = Number((config.amounts && config.amounts[item.name]) ?? (config.amounts && config.amounts[name]) ?? config.amount ?? 1);
    const price = itemLines(item).map(parsePrice).find((value) => value !== null) ?? null;
    found.push({ slot: index, name: item.name, displayName: item.customName || item.displayName || item.name, amount, price });
  });
  return found;
}

function planBuy(bot, window, config = {}) {
  const space = freeSlots(bot, config);
  if (config.dumpWhenFull !== false && space <= 0) {
    return { action: 'dump', space, buys: [], reason: 'inventory penuh, buang dulu' };
  }
  const candidates = findBuyableSlots(window, config);
  const limit = Number(config.maxBuyPerCycle) || 0;
  const buys = [];
  let remaining = space;
  let used = 0;
  for (const candidate of candidates) {
    if (limit > 0 && used >= limit) break;
    const need = stacksNeeded(candidate.name, candidate.amount);
    if (need > remaining) break;
    remaining -= need;
    used += 1;
    buys.push(candidate);
  }
  if (!buys.length) {
    return { action: 'wait', space, buys, reason: candidates.length ? 'ruang tidak cukup' : 'tidak ada item yang cocok di shop' };
  }
  return { action: 'buy', space, buys, reason: `${buys.length} item akan dibeli` };
}

function buildBuyCommand(item, amount, template) {
  const base = template || '/shop buy {item} {amount}';
  return base.replace('{item}', item).replace('{amount}', String(amount));
}

function attachShop(bot, config, logger) {
  const settings = config.shop || {};
  const sleeps = new Set();
  const stats = {
    cycles: 0,
    buys: 0,
    itemsBought: 0,
    dumps: 0,
    drops: 0,
    lastBuy: null,
    lastActionAt: 0
  };

  let started = false;
  let busy = false;
  let lastCycleAt = 0;
  let loopTimer = null;

  const log = logger || { debug() {}, info() {}, warn() {}, success() {} };
  const sleep = (ms) => new Promise((resolve) => {
    const timer = setTimeout(() => {
      sleeps.delete(timer);
      resolve();
    }, ms);
    sleeps.add(timer);
  });

  async function closeWindow() {
    try {
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
    } catch (err) {
      log.debug(`gagal tutup window shop: ${err.message}`);
    }
  }

  async function buyViaCommand() {
    const items = Array.isArray(settings.items) ? settings.items : [];
    if (!items.length) return 0;
    let bought = 0;
    for (const name of items) {
      const amount = Number((settings.amounts && settings.amounts[name]) || settings.amount || 1);
      const command = buildBuyCommand(name, amount, settings.buyCommandTemplate);
      if (freeSlots(bot, settings) <= 0 && settings.dumpWhenFull !== false) {
        const result = await dumpInventory(bot, settings, log);
        stats.drops += result.dropped;
        stats.dumps += 1;
        await sleep(settings.dumpDelayMs || 1000);
      }
      try {
        bot.chat(command);
        bought += 1;
        stats.buys += 1;
        stats.itemsBought += amount;
        stats.lastBuy = `${name} x${amount}`;
        stats.lastActionAt = Date.now();
        log.info(`beli: ${command}`);
        await sleep(Number(settings.buyIntervalMs) || 1500);
      } catch (err) {
        log.debug(`gagal kirim perintah beli: ${err.message}`);
      }
    }
    return bought;
  }

  async function buyViaGui() {
    const window = bot.currentWindow;
    if (!window) return 0;
    const plan = planBuy(bot, window, settings);
    let buys = plan.buys;
    if (plan.action === 'dump') {
      log.warn(plan.reason);
      const result = await dumpInventory(bot, settings, log);
      stats.drops += result.dropped;
      stats.dumps += 1;
      await sleep(settings.dumpDelayMs || 1000);
      const retry = planBuy(bot, bot.currentWindow, settings);
      if (retry.action !== 'buy') return 0;
      buys = retry.buys;
    }
    let bought = 0;
    for (const item of buys) {
      try {
        await bot.clickWindow(item.slot, settings.shiftBuy ? 1 : 0, 0);
        bought += 1;
        stats.buys += 1;
        stats.itemsBought += item.amount;
        stats.lastBuy = `${item.name} x${item.amount}${item.price !== null ? ` (${item.price})` : ''}`;
        stats.lastActionAt = Date.now();
        log.success(`beli ${item.displayName} x${item.amount} dari slot ${item.slot}`);
        await sleep(Number(settings.buyIntervalMs) || 1500);
      } catch (err) {
        log.debug(`gagal klik slot ${item.slot}: ${err.message}`);
      }
    }
    if (!bought) log.debug(`shop: ${plan.reason}`);
    return bought;
  }

  async function runCycle() {
    if (busy || !bot.entity) return;
    busy = true;
    stats.cycles += 1;
    try {
      if (settings.dumpWhenFull !== false && isInventoryFull(bot, settings)) {
        log.warn(`inventory penuh (sisa ${freeSlots(bot, settings)} slot), buang semua isi`);
        const result = await dumpInventory(bot, settings, log);
        stats.drops += result.dropped;
        stats.dumps += 1;
        await sleep(Number(settings.dumpDelayMs) || 1000);
      }
      if (settings.command) {
        try {
          bot.chat(settings.command);
        } catch (err) {
          log.debug(`gagal buka shop: ${err.message}`);
        }
        await sleep(Number(settings.openDelayMs) || 1500);
      }
      if ((settings.mode || 'gui') === 'command') {
        await buyViaCommand();
      } else if (bot.currentWindow) {
        await buyViaGui();
      } else if (settings.command) {
        log.debug('shop: GUI belum terbuka, buying lewat perintah');
        await buyViaCommand();
      }
      if (settings.closeAfter) await closeWindow();
    } catch (err) {
      log.debug(`siklus shop gagal: ${err.message}`);
    } finally {
      busy = false;
      lastCycleAt = Date.now();
    }
  }

  async function loop() {
    if (!started) return;
    await runCycle();
    if (!started) return;
    loopTimer = setTimeout(loop, Math.max(5000, Number(settings.intervalMs) || 300000));
  }

  function start() {
    if (started) return;
    if (!settings.enabled) return;
    started = true;
    loop();
    log.info(`auto-shop aktif (mode ${settings.mode || 'gui'}, interval ${settings.intervalMs || 300000}ms)`);
  }

  function stop() {
    started = false;
    if (loopTimer) {
      clearTimeout(loopTimer);
      loopTimer = null;
    }
    for (const timer of sleeps) clearTimeout(timer);
    sleeps.clear();
  }

  return {
    stats,
    start,
    stop,
    runCycle,
    dump: () => dumpInventory(bot, settings, log),
    buy: () => runCycle(),
    get enabled() { return started; },
    get busy() { return busy || false; },
    get lastCycleAt() { return lastCycleAt; }
  };
}

module.exports = {
  attachShop,
  parsePrice,
  freeSlots,
  isInventoryFull,
  planDump,
  dumpInventory,
  findBuyableSlots,
  planBuy,
  buildBuyCommand,
  stacksNeeded,
  DEFAULT_KEEP
};