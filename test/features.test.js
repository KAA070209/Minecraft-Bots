'use strict';

const EventEmitter = require('events');
const { Vec3 } = require('vec3');

const {
  attachCombat, findNearestTarget, isHostile, pickWeapon, weaponScore, planCombat, shouldRetreat, entityKind,
  normalizeName, withinReach, attackInterval, clickInterval, cpsRange, cpsLabel, scanInterval, feetAimPoint
} = require('../lib/combat');
const {
  attachShop, parsePrice, freeSlots, isInventoryFull, planDump, dumpInventory, findBuyableSlots, planBuy,
  buildBuyCommand, stacksNeeded
} = require('../lib/shop');
const {
  scanFarmArea, planHarvest, findNearestDrop, listDrops, isDropEntity, cropName, isCropBlock, isSoil, resolveArea,
  normalizeCrops, isAreaConfigured, walkRadiusOf, maxWalkDistanceOf, searchRadiusOf, searchIntervalOf, searchFarmArea, distanceToArea, pickTool, countCropTypes, attachFarm,
  cropWalkStepsOf, chaseRangeOf, pathRadiusOf, resolveBounds, describeArea, areaTarget
} = require('../lib/farm');
const { findPath, cellBlockedBy, isPassableBlock, isGroundBlock } = require('../lib/pathing');
const {
  readInventory, describeItem, itemLabel, prettyName, stripColor, searchItems, formatInventory,
  inventoryReport, slotColumn, inHotbar
} = require('../lib/inventory');
const { loadConfig } = require('../lib/config');
const { loadProfiles, validateProfile } = require('../lib/profiles');

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition) });
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}

function quietLogger() {
  return { debug() {}, info() {}, warn() {}, success() {} };
}

function makeBot(overrides = {}) {
  const bot = new EventEmitter();
  bot.entity = { id: 0, position: new Vec3(0.5, 64, 0.5), height: 1.8, yaw: 0, pitch: 0, health: 20, onGround: true };
  bot.health = 20;
  bot.food = 20;
  bot.entities = {};
  bot.hits = [];
  bot.moves = [];
  bot.messages = [];
  bot.tossed = [];
  bot.clicks = [];
  bot.inventory = { items: () => [] };
  bot.lookAt = () => Promise.resolve();
  bot.look = () => Promise.resolve();
  bot.attack = (entity) => { bot.hits.push(entity.id); };
  bot.setControlState = (state, value) => { if (value) bot.moves.push(state); };
  bot.stop = () => {};
  bot.clearControlStates = () => {};
  bot.swingArm = () => {};
  bot.equip = (item) => { bot.held = item.name; return Promise.resolve(); };
  bot.chat = (message) => { bot.messages.push(message); };
  bot.toss = (type, meta, count) => { bot.tossed.push({ type, count }); return Promise.resolve(); };
  bot.clickWindow = (slot) => { bot.clicks.push(slot); return Promise.resolve(); };
  bot.closeWindow = () => {};
  bot.dig = () => Promise.resolve();
  bot.placeBlock = () => Promise.resolve();
  Object.assign(bot, overrides);
  return bot;
}

const pending = [];

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: filter target\n');
{
  check('zombie termasuk mob hostile', isHostile({ name: 'zombie' }) === true);
  check('creeper termasuk mob hostile', isHostile({ name: 'creeper' }) === true);
  const player = { name: 'player', username: 'Azka', position: new Vec3(1, 64, 1) };
  check('player tidak pernah ditargetkan', isHostile(player) === false);
  check('player boleh ditargetkan kalau diizinkan', isHostile(player, { attackPlayers: true }) === true);
  check('villager tidak ditargetkan', isHostile({ name: 'villager' }) === false);
  check('armor_stand tidak ditargetkan', isHostile({ name: 'armor_stand' }) === false);
  check('warden tidak ditargetkan', isHostile({ name: 'warden' }) === false);
  check('mob mati tidak ditargetkan', isHostile({ name: 'zombie', health: 0 }) === false);
  check('ignore list dipakai', isHostile({ name: 'zombie' }, { ignore: ['zombie'] }) === false);
  check('whitelist membatasi jenis', isHostile({ name: 'cow' }, { whitelist: ['zombie'] }) === false);
  check('whitelist mengizinkan cow', isHostile({ name: 'cow' }, { whitelist: ['cow'] }) === true);
  check('entity tanpa nama ditolak', isHostile({}) === false);
  check('entityKind baca entityType.name', entityKind({ entityType: { name: 'creeper' } }) === 'creeper');
  check('entityKind baca entityType string', entityKind({ entityType: 'zombie' }) === 'zombie');
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: pilih target terdekat\n');
{
  const bot = makeBot();
  bot.entities = {
    1: { id: 1, name: 'zombie', position: new Vec3(9, 64, 0), health: 20 },
    2: { id: 2, name: 'skeleton', position: new Vec3(3, 64, 0), health: 20 },
    3: { id: 3, name: 'cow', position: new Vec3(1, 64, 0), health: 10 },
    4: { id: 4, name: 'spider', position: new Vec3(40, 64, 0), health: 20 }
  };
  const target = findNearestTarget(bot, { range: 12 });
  check('target terdekat dipilih', Boolean(target) && target.entity.id === 2, target ? String(target.entity.id) : 'null');
  check('jarak target dihitung', Boolean(target) && Math.abs(target.distance - 2.5495) < 0.01, target ? String(target.distance) : 'null');
  check('jangkauan membatasi', findNearestTarget(bot, { range: 2 }) === null);
  check('tanpa entities -> null', findNearestTarget(makeBot(), {}) === null);
  check('bot tanpa entity -> null', findNearestTarget({ entities: {} }, {}) === null);
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: pilih senjata\n');
{
  check('pedang netherite tertinggi', weaponScore('netherite_sword').score === 140, String(weaponScore('netherite_sword').score));
  check('pedang batu menang dari kapak besi', weaponScore('stone_sword').score > weaponScore('iron_axe').score);
  check('kapak > beliung > sekop', weaponScore('iron_axe').score > weaponScore('iron_pickaxe').score && weaponScore('iron_pickaxe').score > weaponScore('iron_shovel').score);
  check('label senjata', weaponScore('iron_sword').label === 'pedang', weaponScore('iron_sword').label);
  check('bukan senjata -> null', weaponScore('dirt') === null);

  const bot = makeBot();
  bot.inventory = { items: () => [{ name: 'cobblestone', count: 64 }, { name: 'stone_sword', count: 1 }, { name: 'iron_sword', count: 1 }] };
  const weapon = pickWeapon(bot, {});
  check('senjata terbaik dipakai', weapon.name === 'iron_sword', String(weapon.name));
  check('item dilute yang benar', Boolean(weapon.item) && weapon.item.name === 'iron_sword');
  check('ignore senjata dihormati', pickWeapon(bot, { ignore: ['iron_sword'] }).name === 'stone_sword');
  const empty = pickWeapon(makeBot(), {});
  check('tanpa senjata = tangan kosong', empty.item === null && empty.label === 'tangan kosong');
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: keputusan plan\n');
{
  const bot = makeBot();
  bot.entities = { 1: { id: 1, name: 'zombie', position: new Vec3(0.5, 64, 8), health: 20 } };
  check('jarak jauh -> approach', planCombat(bot, { range: 12 }).action === 'approach');
  bot.entities[1].position = new Vec3(0.5, 64, 2);
  check('jarak dekat -> attack', planCombat(bot, { range: 12 }).action === 'attack');
  bot.entities = {};
  check('tidak ada mob -> idle', planCombat(bot, { range: 12 }).action === 'idle');
  bot.health = 4;
  check('HP kritis -> retreat', planCombat(bot, { range: 12, retreatBelowHealth: 6 }).action === 'retreat');
  check('tanpa batas HP -> tidak retreat', shouldRetreat(bot, { retreatBelowHealth: 0 }) === false);
  check('tanpa entity -> wait', planCombat({ entities: {} }, {}).action === 'wait');
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: agent melee\n');
{
  const bot = makeBot();
  bot.entities = { 7: { id: 7, name: 'zombie', position: new Vec3(0.5, 64, 2), health: 20 } };
  bot.inventory = { items: () => [{ name: 'iron_sword', count: 1 }] };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 10000, retreatBelowHealth: 0 }
  }, quietLogger());
  combat.start();
  check('serangan pertama masuk', bot.hits.length === 1, JSON.stringify(bot.hits));
  check('tangan memegang senjata', bot.held === 'iron_sword', String(bot.held));
  bot.hits.length = 0;
  combat.tick();
  check('cooldown menahan spam', bot.hits.length === 0);
  bot.emit('entityDead', bot.entities[7]);
  check('knock dihitung', combat.stats.kills === 1, String(combat.stats.kills));
  check('nama target tersimpan', combat.stats.lastTarget === 'zombie', String(combat.stats.lastTarget));
  combat.stop();
  check('stop mematikan loop', combat.enabled === false);

  bot.entities = { 8: { id: 8, name: 'zombie', position: new Vec3(0.5, 64, 9), health: 20 } };
  const combat2 = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0 }
  }, quietLogger());
  bot.hits.length = 0;
  bot.moves.length = 0;
  combat2.start();
  check('target jauh tidak dipukul', bot.hits.length === 0);
  check('target jauh dikejar', bot.moves.includes('forward'), JSON.stringify(bot.moves));
  check('target dicatat', String(combat2.stats.lastTarget).includes('dekati'), String(combat2.stats.lastTarget));
  combat2.stop();

  const disabled = attachCombat(bot, { combat: { enabled: false } }, quietLogger());
  disabled.start();
  check('enabled=false tidak jalan', disabled.enabled === false);
  disabled.setEnabled(true);
  check('setEnabled(true) menyalakan', disabled.enabled === true);
  disabled.stop();
}

process.stdout.write('\n');
process.stdout.write('[features] shop: baca harga\n');
{
  check('Harga: 1.500 koin', parsePrice('Harga: 1.500 koin') === 1500, String(parsePrice('Harga: 1.500 koin')));
  check('Price: 250', parsePrice('Price: 250') === 250);
  check('Buy for 100 emerald', parsePrice('Buy for 100 emerald') === 100);
  check('format ribuan titik', parsePrice('Harga 1.000.000') === 1000000, String(parsePrice('Harga 1.000.000')));
  check('tanpa harga -> null', parsePrice('Wortel segar') === null);
  check('input kosong -> null', parsePrice('') === null);
  check('stacksNeeded 64 -> 1', stacksNeeded('carrot', 64) === 1);
  check('stacksNeeded 65 -> 2', stacksNeeded('carrot', 65) === 2);
  check('stacksNeeded 0 -> 1', stacksNeeded('carrot', 0) === 1);
}

process.stdout.write('\n');
process.stdout.write('[features] shop: cek inventory penuh\n');
{
  const full = makeBot();
  full.inventory = { items: () => Array.from({ length: 36 }, (_, i) => ({ name: `item${i}`, count: 64 })) };
  check('inventory 36 slot penuh', isInventoryFull(full, {}) === true);
  check('sisa slot 0', freeSlots(full, {}) === 0, String(freeSlots(full, {})));
  check('reserve 1 slot tetap penuh', isInventoryFull(full, { reserveSlots: 1 }) === true);
  const some = makeBot();
  some.inventory = { items: () => Array.from({ length: 30 }, (_, i) => ({ name: `item${i}`, count: 1 })) };
  check('inventory 30/36 belum penuh', isInventoryFull(some, {}) === false);
  check('sisa slot 6', freeSlots(some, {}) === 6, String(freeSlots(some, {})));
}

process.stdout.write('\n');
process.stdout.write('[features] shop: buang isi inventory\n');
{
  const bot = makeBot();
  const stock = [{ name: 'cobblestone', count: 64, type: 9 }, { name: 'shield', count: 1, type: 9 }, { name: 'dirt', count: 12, type: 2 }];
  bot.inventory = { items: () => stock.slice() };
  const plan = planDump(bot, { keep: ['shield'] });
  check('dump semua kecuali keep', plan.drop.length === 2, JSON.stringify(plan.drop));
  check('item keep tidak dibuang', !plan.drop.some((entry) => entry.name === 'shield'));
  bot.toss = (type, meta, count) => {
    bot.tossed.push({ type, count });
    const index = stock.findIndex((entry) => entry.type === type);
    if (index !== -1) stock.splice(index, 1);
    return Promise.resolve();
  };
  pending.push(dumpInventory(bot, { keep: ['shield'] }, quietLogger()).then((result) => {
    check('tumpukan dibuang sesuai keep', result.dropped === 2, String(result.dropped));
    check('isi inventory tinggal shield', stock.length === 1 && stock[0].name === 'shield', JSON.stringify(stock));
  }));
}

process.stdout.write('\n');
process.stdout.write('[features] shop: pilih slot untuk dibeli\n');
{
  const window = {
    slots: [
      { item: { name: 'air' } },
      { item: { name: 'carrot', count: 1, customName: 'Wortel', customLore: ['Harga: 500'] } },
      { item: { name: 'stone', count: 1 } },
      { item: { name: 'cooked_beef', count: 1, customLore: ['Price: 1200'] } },
      { item: { name: 'carrot', count: 1, customLore: ['Harga: 550'] } }
    ]
  };
  const found = findBuyableSlots(window, { items: ['carrot', 'cooked_beef'], amounts: { carrot: 64, cooked_beef: 32 } });
  check('hanya item yang diminta', found.length === 3, String(found.length));
  check('slot benar untuk wortel pertama', found[0].slot === 1, String(found[0].slot));
  check('jumlah dari amounts', found[0].amount === 64 && found[1].amount === 32, `${found[0].amount}/${found[1].amount}`);
  check('harga dari lore dibaca', found[0].price === 500, String(found[0].price));
  check('harga format Price', found[1].price === 1200, String(found[1].price));
  check('tidak ada yang cocok -> array kosong', findBuyableSlots(window, { items: ['emerald'] }).length === 0);

  const roomy = makeBot();
  roomy.inventory = { items: () => [] };
  const both = planBuy(roomy, window, { items: ['carrot'], amounts: { carrot: 64 } });
  check('ruang cukup -> action buy', both.action === 'buy', both.reason);
  check('semua slot wortel kebeli', both.buys.length === 2, String(both.buys.length));

  const tight = makeBot();
  tight.inventory = { items: () => Array.from({ length: 35 }, () => ({ name: 'x', count: 1 })) };
  const one = planBuy(tight, window, { items: ['carrot'], amounts: { carrot: 64 } });
  check('ruang 1 slot -> hanya 1 pembelian', one.action === 'buy' && one.buys.length === 1, JSON.stringify(one.buys.length));

  const full = makeBot();
  full.inventory = { items: () => Array.from({ length: 36 }, () => ({ name: 'x', count: 1 })) };
  check('inventory penuh -> action dump', planBuy(full, window, { items: ['carrot'], dumpWhenFull: true }).action === 'dump');

  check('tidak ada item cocok -> wait', planBuy(roomy, window, { items: ['emerald'] }).action === 'wait');
  check('maxBuyPerCycle membatasi', planBuy(roomy, window, { items: ['carrot', 'cooked_beef'], maxBuyPerCycle: 1 }).buys.length === 1);

  check('template perintah default', buildBuyCommand('carrot', 64) === '/shop buy carrot 64', buildBuyCommand('carrot', 64));
  check('template custom', buildBuyCommand('carrot', 32, '/buy {amount} {item}') === '/buy 32 carrot', buildBuyCommand('carrot', 32, '/buy {amount} {item}'));
}

process.stdout.write('\n');
process.stdout.write('[features] shop: agent beli lewat GUI\n');
{
  const bot = makeBot();
  bot.currentWindow = { slots: [{ item: { name: 'carrot', count: 1, customLore: ['Harga: 200'] } }] };
  const shop = attachShop(bot, {
    shop: {
      enabled: true, mode: 'gui', items: ['carrot'], amounts: { carrot: 64 }, buyIntervalMs: 200,
      dumpWhenFull: true, reserveSlots: 1, maxBuyPerCycle: 8, closeAfter: false, intervalMs: 100000
    }
  }, quietLogger());
  pending.push(shop.buy().then(() => {
    check('slot shop diklik', bot.clicks.length === 1 && bot.clicks[0] === 0, JSON.stringify(bot.clicks));
    check('statistik beli naik', shop.stats.buys === 1 && shop.stats.itemsBought === 64, JSON.stringify(shop.stats));
    shop.stop();
  }));

  const cmdBot = makeBot();
  const cmdShop = attachShop(cmdBot, {
    shop: {
      enabled: true, mode: 'command', items: ['carrot', 'wheat'], buyIntervalMs: 200,
      dumpWhenFull: false, buyCommandTemplate: '/buy {item} {amount}', intervalMs: 100000
    }
  }, quietLogger());
  pending.push(cmdShop.buy().then(() => {
    check('mode command mengirim /buy', cmdBot.messages.join(',') === '/buy carrot 1,/buy wheat 1', cmdBot.messages.join(','));
    cmdShop.stop();
  }));

  const dumpBot = makeBot();
  const stock = Array.from({ length: 36 }, (_, i) => ({ name: `item${i}`, count: 64, type: i }));
  dumpBot.inventory = { items: () => stock.slice() };
  dumpBot.currentWindow = { slots: [{ item: { name: 'carrot', count: 1 } }] };
  const dumpShop = attachShop(dumpBot, {
    shop: { enabled: true, mode: 'gui', items: ['carrot'], buyIntervalMs: 200, dumpWhenFull: true, dumpDelayMs: 200, closeAfter: false, intervalMs: 100000 }
  }, quietLogger());
  dumpBot.toss = (type) => {
    const index = stock.findIndex((entry) => entry.type === type);
    if (index !== -1) stock.splice(index, 1);
    return Promise.resolve();
  };
  pending.push(dumpShop.buy().then(() => {
    check('inventory penuh dibuang dulu', stock.length === 0, String(stock.length));
    check('statistik buang naik', dumpShop.stats.drops === 36, String(dumpShop.stats.drops));
    dumpShop.stop();
  }));
}

process.stdout.write('\n');
process.stdout.write('[features] inventory: baca isi tas\n');
{
  check('nama item underscore jadi spasi', prettyName('cooked_beef') === 'cooked beef', prettyName('cooked_beef'));
  check('kode warna dibuang', stripColor('\u00a7aWortel \u00a7fSegar') === 'Wortel Segar', stripColor('\u00a7aWortel \u00a7fSegar'));
  check('nama kosong -> unknown', prettyName('') === 'unknown');
  check('label pakai customName', itemLabel({ name: 'carrot', customName: 'Wortel' }) === 'Wortel', itemLabel({ name: 'carrot', customName: 'Wortel' }));
  check('label fallback ke nama', itemLabel({ name: 'carrot' }) === 'carrot', itemLabel({ name: 'carrot' }));
  check('label tanpa item -> -', itemLabel(null) === '-');

  const described = describeItem({ name: 'stone', count: 64, slot: 12, type: 1 });
  check('slot terbaca', described.slot === 12, String(described.slot));
  check('jumlah item terbaca', described.count === 64);
  check('item tanpa slot -> null', describeItem({ name: 'stone', count: 1 }).slot === null);
  check('item null -> null', describeItem(null) === null);
  check('slot kolom rata kanan', slotColumn(9) === ' 9' && slotColumn(null) === ' -', slotColumn(9));

  const bot = makeBot();
  bot.inventory = {
    items: () => [
      { name: 'dirt', count: 12, slot: 14, type: 2 },
      { name: 'iron_sword', count: 1, slot: 9, type: 9 },
      { name: 'shield', count: 1, slot: 11, type: 9 }
    ]
  };
  bot.heldItem = { name: 'iron_sword', count: 1, slot: 9, type: 9 };
  bot.quickBarSlot = 0;
  const snap = readInventory(bot, {});
  check('3 tumpukan terbaca', snap.used === 3, String(snap.used));
  check('sisa slot dihitung', snap.free === 33 && snap.total === 36, `${snap.free}/${snap.total}`);
  check('total item dijumlahkan', snap.amount === 14, String(snap.amount));
  check('urutan berdasarkan slot', snap.items.map((i) => i.slot).join(',') === '9,11,14', snap.items.map((i) => i.slot).join(','));
  check('item tangan terdeteksi', Boolean(snap.held) && snap.held.name === 'iron_sword', snap.held ? snap.held.name : 'null');
  check('slot tangan dari quickBarSlot', snap.selectedSlot === 9, String(snap.selectedSlot));
  check('bot tanpa tas tetap aman', readInventory(makeBot(), {}).used === 0);
  check('bot null tetap aman', readInventory(null, {}).total === 36);
  check('slot hotbar dikenali', inHotbar(9) === true && inHotbar(35) === false);
}

process.stdout.write('\n');
process.stdout.write('[features] inventory: filter dan format\n');
{
  const items = [
    { name: 'carrot', label: 'carrot', count: 64, slot: 9 },
    { name: 'cooked_beef', label: 'cooked beef', count: 12, slot: 10 },
    { name: 'carrot', label: 'wortel', count: 32, slot: 11 },
    { name: 'shield', label: 'shield', count: 1, slot: 12 }
  ];
  check('filter nama item', searchItems(items, 'carrot').length === 2, String(searchItems(items, 'carrot').length));
  check('filter label custom', searchItems(items, 'wortel').length === 1, String(searchItems(items, 'wortel').length));
  check('filter tidak ada -> kosong', searchItems(items, 'emerald').length === 0);
  check('tanpa filter -> semua', searchItems(items, '').length === 4);
  check('filter input non-array aman', searchItems(null, 'carrot').length === 0);

  const snapshot = { total: 36, used: 4, free: 32, stacks: 4, amount: 109, items, held: items[0], selectedSlot: 9 };
  const full = formatInventory(snapshot, {});
  check('baris ringkasan ada', full.lines[0].includes('4/36 terpakai'), full.lines[0]);
  check('baris total ada', full.lines[1].includes('109 item'), full.lines[1]);
  check('baris tangan ada', full.lines[2].includes('carrot x64'), full.lines[2]);
  check('empat baris item dicetak', full.shown === 4 && full.hidden === 0, `${full.shown}/${full.hidden}`);
  check('tag hotbar dicetak', full.lines[3].includes('hotbar') && full.lines[3].includes('tangan'), full.lines[3]);
  const tagged = full.lines.filter((l) => l.startsWith('  ') && l.includes('tangan'));
  check('tag tangan hanya di slot tangan', tagged.length === 1 && tagged[0].includes('9'), String(tagged.length));

  const limited = formatInventory(snapshot, { limit: 2 });
  check('limit memotong baris', limited.shown === 2 && limited.hidden === 2, `${limited.shown}/${limited.hidden}`);
  check('sisa baris dilaporkan', limited.lines.some((l) => l.includes('2 tumpukan lain')), limited.lines[limited.lines.length - 1]);

  const filtered = formatInventory(snapshot, { query: 'carrot' });
  check('filter reducing baris', filtered.shown === 2, String(filtered.shown));
  check('baris filter dicetak', filtered.lines.some((l) => l.includes('"carrot" -> 2 tumpukan / 96 item')), filtered.lines[3]);

  const empty = formatInventory({ total: 36, used: 0, free: 36, stacks: 0, amount: 0, items: [], held: null, selectedSlot: null }, {});
  check('inventory kosong', empty.lines.some((l) => l === 'inventory kosong'), empty.lines.join('|'));
  check('tangan kosong', empty.lines[2].includes('kosong'), empty.lines[2]);

  const noMatch = formatInventory(snapshot, { query: 'emerald' });
  check('filter tanpa hasil', noMatch.lines.some((l) => l === 'tidak ada item yang cocok'), noMatch.lines.join('|'));

  const bot = makeBot();
  bot.inventory = { items: () => items };
  bot.quickBarSlot = 0;
  const report = inventoryReport(bot, { query: 'shield' });
  check('inventoryReport gabung snapshot + baris', report.snapshot.used === 4 && report.shown === 1 && report.query === 'shield', JSON.stringify({ u: report.snapshot.used, s: report.shown, q: report.query }));
  check('inventoryReport tanpa bot tetap jalan', inventoryReport(null, {}).shown === 0);
}

process.stdout.write('\n');
process.stdout.write('[features] panen: block tanaman dan tanah\n');
{
  check('carrots = wortel', cropName('carrots') === 'carrot');
  check('wheat = gandum', cropName('wheat') === 'wheat');
  check('potatoes = kentang', cropName('potatoes') === 'potato');
  check('beetroots = bit', cropName('beetroots') === 'beetroot');
  check('isCropBlock carrots', isCropBlock('carrots') === true);
  check('isCropBlock dirt salah', isCropBlock('dirt') === false);
  check('isSoil farmland', isSoil('farmland') === true);
  check('isSoil air salah', isSoil('air') === false);
  const area = resolveArea({ area: { x: 10, y: 64, z: -3, radius: 5 } });
  check('resolveArea baca radius', area.radius === 5 && area.x === 10 && area.z === -3, JSON.stringify(area));
  check('resolveArea radius dibatasi 32', resolveArea({ area: { x: 0, y: 0, z: 0, radius: 99 } }).radius === 32);
  check('resolveArea tanpa koordinat -> null', resolveArea({}) === null);
  check('resolveArea mode lingkaran dapat batas kotak', resolveArea({ area: { x: 0, y: 64, z: 0, radius: 4 } }).minX === -4 && resolveArea({ area: { x: 0, y: 64, z: 0, radius: 4 } }).box === false);
}

process.stdout.write('\n');
process.stdout.write('[features] panen: area kotak (min/max)\n');
{
  const box = resolveArea({ area: { y: 62, bounds: { minX: 7986, maxX: 8084, minZ: 7507, maxZ: 7572 } } });
  check('kotak dibaca apa adanya', box.minX === 7986 && box.maxX === 8084 && box.minZ === 7507 && box.maxZ === 7572, JSON.stringify(box));
  check('kotak ditandai box', box.box === true);
  check('titik tengah kotak dihitung', box.x === 8035 && box.z === 7539 && box.y === 62, `${box.x},${box.y},${box.z}`);
  check('kotak dianggap sudah diisi', isAreaConfigured(box) === true);

  const swapped = resolveArea({ area: { y: 62, bounds: { minX: 8084, maxX: 7986, minZ: 7572, maxZ: 7507 } } });
  check('batas terbalik ditukar', swapped.minX === 7986 && swapped.maxX === 8084 && swapped.minZ === 7507 && swapped.maxZ === 7572, JSON.stringify(swapped));

  const points = resolveArea({ area: { y: 62, bounds: { min: { x: 10, z: 20 }, max: { x: 30, z: 40 } } } });
  check('bounds titik min/max juga diterima', points.minX === 10 && points.maxX === 30 && points.minZ === 20 && points.maxZ === 40, JSON.stringify(points));

  const corners = resolveArea({
    area: {
      y: 62,
      corners: [[7986.3, 62.94, 7507.34], [8084.7, 62.94, 7507.34], [8084.7, 62.94, 7572.7], [7986.3, 62.94, 7572.7]]
    }
  });
  check('4 sudut -> kotak yang sama', corners.minX === 7986 && corners.maxX === 8084 && corners.minZ === 7507 && corners.maxZ === 7572, JSON.stringify(corners));

  const huge = resolveArea({ area: { y: 62, bounds: { minX: 0, maxX: 5000, minZ: 0, maxZ: 10 } } });
  check('kotak dibatasi 256 blok per sisi', huge.maxX - huge.minX === 256, String(huge.maxX - huge.minX));

  const roundTrip = resolveArea({ area: box });
  check('area hasil resolve bisa dipakai ulang', roundTrip.box === true && roundTrip.minX === box.minX && roundTrip.maxZ === box.maxZ, JSON.stringify(roundTrip));

  check('describeArea kotak menyebut batas', /kotak X 7986\.\.8084 Z 7507\.\.7572 \(99x66 blok\)/.test(describeArea(box)), describeArea(box));
  check('describeArea lingkaran menyebut radius', /radius 4/.test(describeArea(resolveArea({ area: { x: 0, y: 64, z: 0, radius: 4 } }))));

  // scan hanya mengitari kotak, bukan satu blok di pojoknya
  const world = new Map();
  const put = (x, y, z, name) => world.set(`${x},${y},${z}`, name);
  for (const [x, z] of [[100, 100], [104, 100], [100, 104], [104, 104], [90, 90], [108, 108]]) {
    put(x, 60, z, 'farmland');
    put(x, 61, z, 'carrots');
  }
  const worldBot = makeBot({
    blockAt: (position) => {
      const name = world.get(`${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`);
      return name ? { name, position: position.floored() } : null;
    }
  });
  worldBot.entity.position = new Vec3(102.5, 61, 102.5);
  const boxCrops = scanFarmArea(worldBot, {
    area: { y: 62, bounds: { minX: 100, maxX: 104, minZ: 100, maxZ: 104 } },
    crops: ['carrots'],
    scanHeight: 2
  });
  check('scan menutup 4 sudut kotak', boxCrops.length === 4, JSON.stringify(boxCrops.map((entry) => entry.position.floored())));
  const outside = scanFarmArea(worldBot, {
    area: { y: 62, bounds: { minX: 100, maxX: 104, minZ: 100, maxZ: 104 } },
    crops: ['carrots'],
    scanHeight: 2
  }).every((entry) => Math.abs(entry.position.x - 102.5) <= 2.5 && Math.abs(entry.position.z - 102.5) <= 2.5);
  check('tanaman di luar kotak dilewati', outside === true);
  const tightCircle = scanFarmArea(worldBot, { area: { x: 102, y: 62, z: 102, radius: 1 }, crops: ['carrots'], scanHeight: 2 });
  check('lingkaran radius kecil tidak sampai sudut', tightCircle.length === 0 && boxCrops.length === 4, `${tightCircle.length} vs ${boxCrops.length}`);

  check('resolveBounds baca min/max langsung', JSON.stringify(resolveBounds({ bounds: { minX: 7986, maxX: 8084, minZ: 7507, maxZ: 7572 } })) === JSON.stringify({ minX: 7986, maxX: 8084, minZ: 7507, maxZ: 7572 }), JSON.stringify(resolveBounds({ bounds: { minX: 7986, maxX: 8084, minZ: 7507, maxZ: 7572 } })));
  check('resolveBounds tanpa bounds -> null', resolveBounds({ x: 1, y: 2, z: 3, radius: 4 }) === null);
  const outsidePos = new Vec3(7900.5, 62, 7600.5);
  const edge = areaTarget(box, outsidePos);
  check('tujuan jalan dijepit ke tepi kotak', edge.x === 7986.5 && edge.z === 7572.5, edge.floored().toString());
  const insideTarget = areaTarget(box, new Vec3(8035.5, 62, 7540.5));
  check('bot di dalam kotak -> bot tetap jadi tujuan', insideTarget.x === 8035.5 && insideTarget.z === 7540.5, insideTarget.toString());

  const botOutside = makeBot();
  botOutside.entity.position = new Vec3(7900.5, 62, 7600.5);
  check('jarak ke kotak dihitung dari tepi', Math.round(distanceToArea(botOutside, box)) === Math.round(Math.hypot(86, 28)), String(distanceToArea(botOutside, box)));
  const botInside = makeBot();
  botInside.entity.position = new Vec3(8080.5, 62, 7510.5);
  check('bot di dalam kotak -> jarak 0', distanceToArea(botInside, box) === 0, String(distanceToArea(botInside, box)));
}

process.stdout.write('\n');
process.stdout.write('[features] panen: scan area\n');
{
  const world = new Map();
  const put = (x, y, z, name) => world.set(`${x},${y},${z}`, name);
  put(0, 63, 0, 'farmland');
  put(0, 64, 0, 'carrots');
  put(2, 63, 0, 'farmland');
  put(2, 64, 0, 'wheat');
  put(3, 63, 0, 'grass_block');
  put(3, 64, 0, 'potatoes');
  put(-2, 63, 0, 'farmland');
  put(-2, 64, 0, 'carrots');
  put(10, 63, 0, 'farmland');
  put(10, 64, 0, 'carrots');
  const bot = makeBot({
    blockAt: (position) => {
      const name = world.get(`${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`);
      return name ? { name, position: position.floored() } : null;
    }
  });
  const carrots = scanFarmArea(bot, { area: { x: 0, y: 64, z: 0, radius: 4 }, crops: ['carrots'] });
  check('hanya tanaman yang diminta', carrots.length === 2, JSON.stringify(carrots.map((entry) => entry.position)));
  check('tanaman di atas tanah sawah', carrots.every((entry) => entry.soil === 'farmland'));
  check('tanaman di luar radius dilewati', !carrots.some((entry) => entry.position.x === 10));
  check('diurutkan dari terdekat', carrots[0].distance <= carrots[1].distance, JSON.stringify(carrots.map((e) => e.distance)));
  check('nama tanaman dibaca', carrots[0].crop === 'carrot');

  const all = scanFarmArea(bot, { area: { x: 0, y: 64, z: 0, radius: 4 }, crops: ['carrots', 'wheat', 'potatoes'] });
  check('tiga jenis tanaman di atas tanah ketemu', all.length === 3, String(all.length));
  check('tanaman di atas rumput dilewati', !all.some((entry) => entry.crop === 'potato'));
  const plan = planHarvest(all, { crops: ['carrots'], maxPerCycle: 1 });
  check('filter tanaman dipakai', plan.crops.every((entry) => entry.crop === 'carrot'));
  check('maxPerCycle membatasi', plan.crops.length === 1, String(plan.crops.length));
  check('tanpa tanaman -> wait', planHarvest([], {}).action === 'wait', planHarvest([], {}).reason);
}

process.stdout.write('\n');
process.stdout.write('[features] panen: ambil item jatuh\n');
{
  const bot = makeBot();
  bot.entities = {
    1: { id: 1, name: 'item', position: new Vec3(2, 64, 0) },
    2: { id: 2, name: 'item', position: new Vec3(30, 64, 0) },
    3: { id: 3, name: 'zombie', position: new Vec3(0.5, 64, 0.5) }
  };
  const drop = findNearestDrop(bot, { pickupRadius: 12 });
  check('drop terdekat dipilih', Boolean(drop) && drop.entity.id === 1, drop ? String(drop.entity.id) : 'null');
  check('drop di luar radius dilewati', Boolean(drop) && drop.entity.id !== 2);
  check('tidak ada drop -> null', findNearestDrop(makeBot(), {}) === null);
}

process.stdout.write('\n');
process.stdout.write('[features] panen: drop server sungguhan (metadata shared_flags = 0) tetap diambil\n');
{
  // Regresi: metadata index 0 milik entity item itu shared_flags, yang
  // nilainya 0 untuk drop biasa. Filter lama membuangnya, jadi hasil panen
  // tidak pernah terambil di server nyata sementara test tetap hijau.
  // Bentuk metadata mengikuti 1.19.4+: [shared_flags, air, custom_name,
  // custom_name_visible, silent, no_gravity, pose, ticks_frozen, item]
  const realDrop = (id, x) => ({
    id,
    name: 'item',
    position: new Vec3(x, 64, 0),
    metadata: [0, 300, undefined, 0, 0, 0, 3, 0, { name: 'carrot', count: 1 }]
  });
  const bot = makeBot();
  bot.entities = {
    7: realDrop(7, 1.5),
    8: realDrop(8, 3.5),
    9: { id: 9, name: 'item_stack', position: new Vec3(2.5, 64, 0), metadata: [0] },
    10: { id: 10, name: 'zombie', position: new Vec3(0.5, 64, 0.5), metadata: [0, 20] }
  };
  const drop = findNearestDrop(bot, { pickupRadius: 12 });
  check('drop dengan shared_flags 0 tidak dibuang', Boolean(drop) && drop.entity.id === 7, drop ? String(drop.entity.id) : 'null');
  check('semua drop dalam radius terdaftar', listDrops(bot, { pickupRadius: 12 }).length === 3, String(listDrops(bot, { pickupRadius: 12 }).length));
  check('drop diurutkan dari yang terdekat', listDrops(bot, { pickupRadius: 12 }).map((d) => d.entity.id).join(',') === '7,9,8');
  check('bot harus punya entity untuk mengukur jarak', findNearestDrop({ entities: bot.entities }, {}) === null);
  check('mob bukan drop', isDropEntity(bot.entities[10]) === false);
  check('item_stack ikut dianggap drop', isDropEntity(bot.entities[9]) === true);

  // entity.objectType itu alias deprecated yang mencetak stack trace tiap
  // diakses (prismarine-entity index.js:38). Dipanggil per entity per polling,
  // jadi log jadi sangat ramai. Entity di sini dibuat dengan getter yang meledak.
  const guarded = (entity) => Object.defineProperty(entity, 'objectType', {
    get() { throw new Error('entity.objectType tidak boleh diakses'); },
    enumerable: false,
    configurable: true
  });
  const guardedBot = makeBot();
  guardedBot.entities = {
    // tanpa name, hanya displayName - jalur fallback-nya wajib ikut diuji
    7: guarded({ id: 7, displayName: 'item', position: new Vec3(1.5, 64, 0), metadata: [0] }),
    9: guarded({ id: 9, displayName: 'item_stack', position: new Vec3(2.5, 64, 0), metadata: [0] }),
    10: guarded({ id: 10, name: 'zombie', displayName: 'Zombie', position: new Vec3(0.5, 64, 0.5) })
  };
  let guardedOk = true;
  let guardedIds = '';
  try {
    listDrops(guardedBot, { pickupRadius: 12 });
    isDropEntity(guardedBot.entities[10]);
    cellBlockedBy(guardedBot, 1, 64, 2);
    guardedIds = listDrops(guardedBot, { pickupRadius: 12 }).map((d) => d.entity.id).join(',');
  } catch (err) {
    guardedOk = false;
  }
  check('tidak menyentuh objectType (cari drop + cek jalan)', guardedOk);
  check('drop dari displayName tetap terdeteksi', guardedIds === '7,9', guardedIds || 'tidak ada');
}

process.stdout.write('\n');
process.stdout.write('[features] panen: ambil semua hasil panen, abaikan drop orang lain\n');
{
  const world = new Map();
  const put = (x, y, z, name) => world.set(`${x},${y},${z}`, name);
  const key = (position) => `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  put(1, 63, 2, 'farmland');
  put(1, 64, 2, 'carrots');

  // Drop milik pemain lain yang sudah ada sebelum bot memotong: harus diabaikan.
  const foreign = { id: 900, name: 'item', position: new Vec3(1.5, 64, 2.5), metadata: [0] };

  let dropId = 100;
  let waiting = [];
  const bot = makeBot({
    blockAt: (position) => {
      const name = world.get(key(position));
      return name ? { name, position: position.floored() } : null;
    },
    entity: { id: 0, position: new Vec3(0.5, 64, 0.5), height: 1.8, yaw: 0, pitch: 0, health: 20, onGround: true }
  });
  bot.entities[foreign.id] = foreign;
  bot.held = null;
  bot.inventory = { items: () => [{ name: 'iron_hoe', count: 1, type: 55 }], emptySlotCount: () => 9 };
  bot.equip = (item) => { bot.held = item.name; return Promise.resolve(); };
  bot.dig = (block) => {
    world.delete(key(block.position));
    // Satu tanaman bisa menjatuhkan lebih dari satu stack, jadi dua entity
    // dibuat dari satu kali potong dan keduanya harus ikut terambil.
    const base = block.position.offset(0.5, 0.3, 0.5);
    for (const offset of [0, 1.2]) {
      dropId += 1;
      bot.entities[dropId] = { id: dropId, name: 'item', position: base.offset(offset, 0, offset), metadata: [0] };
      waiting.push(dropId);
    }
    return Promise.resolve();
  };

  // Server simulasi: item hanya masuk tas kalau bot benar-benar sampai di atasnya
  // (dan tidak pernah hilang dengan sendirinya, jadi bot yang harus mengejarnya).
  const server = setInterval(() => {
    const next = waiting.find((id) => bot.entities[id]);
    if (next === undefined) return;
    const item = bot.entities[next].position;
    const dx = item.x - bot.entity.position.x;
    const dz = item.z - bot.entity.position.z;
    const gap = Math.hypot(dx, dz);
    if (gap < 0.6) {
      waiting = waiting.filter((id) => id !== next);
      delete bot.entities[next];
      return;
    }
    bot.entity.position = new Vec3(
      bot.entity.position.x + (dx / gap) * 0.4,
      bot.entity.position.y,
      bot.entity.position.z + (dz / gap) * 0.4
    );
  }, 10);
  server.unref();

  const farm = attachFarm(bot, {
    farm: {
      enabled: true, area: { x: 2, y: 64, z: 2, radius: 3 }, crops: ['carrots'],
      harvestIntervalMs: 10, dropWaitMs: 2000, dropStepMs: 10, pickupAttempts: 40, pickupStepMs: 10,
      approachAttempts: 2, approachStepMs: 10, replant: false, useTool: true, sweepDrops: true
    }
  }, quietLogger());

  pending.push(farm.harvest().then(() => {
    clearInterval(server);
    check('kedua stack hasil panen terambil', farm.stats.pickups === 2, String(farm.stats.pickups));
    check('tidak ada hasil panen tertinggal', waiting.length === 0, JSON.stringify(waiting));
    check('drop pemain lain tidak diambil', bot.entities[foreign.id] === foreign);
    farm.stop();
  }));
}

process.stdout.write('\n');
process.stdout.write('[features] panen: sapu sisa yang gagal terambil di akhir siklus\n');
{
  const world = new Map();
  const put = (x, y, z, name) => world.set(`${x},${y},${z}`, name);
  const key = (position) => `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  put(1, 63, 2, 'farmland');
  put(1, 64, 2, 'carrots');

  const dropPosition = new Vec3(1.5, 64, 2.5);
  // Server simulasi: item hanya masuk tas kalau bot sudah sampai di atasnya,
  // tapi masih dalam jeda pickup (pickup delay) selama 1100ms sejak muncul.
  // Percobaan langsung setelah panen selesai sekitar 820ms (2 langkah + 4x
  // jeda 200ms konfirmasi) jadi pasti gagal, sedangkan sapuan akhir siklus
  // mencoba lagi dan confirm-nya jatuh di 1020ms - sesudah jeda berakhir.
  const handoverAfterMs = 1100;
  let spawnedAt = 0;
  let picked = false;

  const bot = makeBot({
    blockAt: (position) => {
      const name = world.get(key(position));
      return name ? { name, position: position.floored() } : null;
    },
    entity: { id: 0, position: new Vec3(0.5, 64, 0.5), height: 1.8, yaw: 0, pitch: 0, health: 20, onGround: true }
  });
  bot.held = null;
  bot.inventory = { items: () => [{ name: 'iron_hoe', count: 1, type: 55 }], emptySlotCount: () => 9 };
  bot.equip = (item) => { bot.held = item.name; return Promise.resolve(); };
  bot.dig = (block) => {
    world.delete(key(block.position));
    spawnedAt = Date.now();
    bot.entities[500] = { id: 500, name: 'item', position: dropPosition, metadata: [0] };
    return Promise.resolve();
  };

  setInterval(() => {
    const entity = bot.entities[500];
    if (!entity) { picked = true; return; }
    const dx = dropPosition.x - bot.entity.position.x;
    const dz = dropPosition.z - bot.entity.position.z;
    const gap = Math.hypot(dx, dz);
    if (gap < 0.6) {
      if (Date.now() - spawnedAt < handoverAfterMs) return;
      picked = true;
      delete bot.entities[500];
      return;
    }
    bot.entity.position = new Vec3(
      bot.entity.position.x + (dx / gap) * 0.4,
      bot.entity.position.y,
      bot.entity.position.z + (dz / gap) * 0.4
    );
  }, 10).unref();

  const farm = attachFarm(bot, {
    farm: {
      enabled: true, area: { x: 2, y: 64, z: 2, radius: 3 }, crops: ['carrots'],
      harvestIntervalMs: 10, dropWaitMs: 1000, dropStepMs: 10,
      pickupAttempts: 2, pickupStepMs: 10, approachAttempts: 2, approachStepMs: 10,
      replant: false, useTool: false, sweepDrops: true, sweepLimit: 3
    }
  }, quietLogger());

  pending.push(farm.harvest().then(() => {
    check('percobaan pertama gagal, bot mencoba lagi', picked === true);
    check('sisa hasil panen disapu di akhir siklus', farm.stats.pickups === 1, String(farm.stats.pickups));
    check('item benar-benar masuk tas', bot.entities[500] === undefined);
    check('tanaman tetap dipanen', farm.stats.harvests === 1, String(farm.stats.harvests));
    farm.stop();
  }));
}

process.stdout.write('\n');
process.stdout.write('[features] panen: agent memanen, ambil drop, tanam ulang\n');
{
  const world = new Map();
  const put = (x, y, z, name) => world.set(`${x},${y},${z}`, name);
  const key = (position) => `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  put(1, 63, 2, 'farmland');
  put(1, 64, 2, 'carrots');
  put(2, 63, 2, 'farmland');
  put(2, 64, 2, 'carrots');

  let dropId = 100;
  const bot = makeBot({
    blockAt: (position) => {
      const name = world.get(key(position));
      return name ? { name, position: position.floored() } : null;
    },
    entity: { id: 0, position: new Vec3(0.5, 64, 0.5), height: 1.8, yaw: 0, pitch: 0, health: 20, onGround: true }
  });
  bot.held = null;
  bot.inventory = { items: () => [{ name: 'iron_hoe', count: 1, type: 55 }, { name: 'carrot', count: 4, type: 39 }] };
  bot.equip = (item) => { bot.held = item.name; return Promise.resolve(); };
  bot.dig = (block) => {
    world.delete(key(block.position));
    dropId += 1;
    const id = dropId;
    bot.entities[id] = { id, name: 'item', position: block.position.offset(0.5, 0.3, 0.5) };
    // simulasi item masuk tas setelah bot mendekat (margin waktu lega biar test tidakDepends on timing)
    setTimeout(() => { delete bot.entities[id]; }, 800);
    return Promise.resolve();
  };
  bot.placeBlock = (reference) => {
    world.set(key(reference.position.offset(0, 1, 0)), 'carrots');
    return Promise.resolve();
  };

  const farm = attachFarm(bot, {
    farm: {
      enabled: true, area: { x: 2, y: 64, z: 2, radius: 3 }, crops: ['carrots'],
      harvestIntervalMs: 10, dropWaitMs: 2000, dropStepMs: 25, pickupAttempts: 2, pickupStepMs: 10,
      approachAttempts: 2, approachStepMs: 10, replant: true, useTool: true
    }
  }, quietLogger());

  // filter ditulis sebagai nama item ("carrot"), bukan nama blok ("carrots")
  pending.push(farm.harvest().then((done) => {
    check('tanaman dipanen', done === 2, String(done));
    check('statistik panen naik', farm.stats.harvests === 2, String(farm.stats.harvests));
    check('wortel terhitung', farm.stats.carrots === 2, String(farm.stats.carrots));
    check('drop terambil', farm.stats.pickups === 2, String(farm.stats.pickups));
    check('tanam ulang jalan', farm.stats.replants === 2, String(farm.stats.replants));
    check('tanaman tumbuh lagi', world.get('1,64,2') === 'carrots', String(world.get('1,64,2')));
    check('cangkul dipakai memanen', bot.held === 'iron_hoe' || bot.held === 'carrot', String(bot.held));
    const info = farm.status();
    check('status melaporkan 2 tanaman', info.crops === 2, String(info.crops));
    check('status menghitung tipe', info.types.carrot === 2, JSON.stringify(info.types));
    farm.stop();
  }));
}

process.stdout.write('\n');
process.stdout.write('[features] panen: diagnosa saat gagal\n');
function captureLogger(sink) {
  return {
    debug: (m) => sink.push(['debug', m]),
    info: (m) => sink.push(['info', m]),
    warn: (m) => sink.push(['warn', m]),
    success: (m) => sink.push(['success', m])
  };
}

{
  const messages = [];
  const logger = captureLogger(messages);
  // lahan dekat tapi kosong -> harus ada warn yang menyebut farm.crops
  const bot = makeBot({ blockAt: () => null });
  const farm = attachFarm(bot, {
    farm: { enabled: true, area: { x: 2, y: 64, z: 0, radius: 4 }, crops: ['carrots'], walkToRadius: 0 }
  }, logger);
  check('area 0,0,0 dianggap belum diisi', isAreaConfigured(resolveArea({ area: { x: 0, y: 0, z: 0 } })) === false);
  check('area x=0 z=0 dianggap belum diisi', isAreaConfigured(resolveArea({ area: { x: 0, y: 64, z: 0 } })) === false);
  check('area terisi dianggap valid', isAreaConfigured(resolveArea({ area: { x: 10, y: 64, z: -5 } })) === true);
  const nearby = distanceToArea(bot, { x: 3, y: 64, z: 0 });
  check('jarak ke area dihitung', nearby > 2.9 && nearby < 3.1, String(nearby));
  check('walkToRadius 0 berarti tidak jalan', walkRadiusOf({ walkToRadius: 0 }) === 0);
  check('walkToRadius default 24', walkRadiusOf({}) === 24);
  check('cropWalkSteps default tanpa batas', cropWalkStepsOf({}) === 0, String(cropWalkStepsOf({})));
  check('cropWalkSteps diisi dipakai', cropWalkStepsOf({ cropWalkSteps: 40 }) === 40);
  check('chaseRange default tanpa batas', chaseRangeOf({}) === 0, String(chaseRangeOf({})));
  check('chaseRange diisi dipakai', chaseRangeOf({ chaseRange: 10 }) === 10);
  check('pathRadius default 24', pathRadiusOf({}) === 24, String(pathRadiusOf({})));
  pending.push(farm.harvest().then(() => {
    const warn = messages.filter(([level]) => level === 'warn').map(([, text]) => text).join(' | ');
    check('ada pesan warn saat tanaman tidak ketemu', /tidak ada tanaman/.test(warn), warn.slice(0, 120));
    check('pesan menyinggung farm.crops', /farm\.crops/.test(warn), warn.slice(0, 160));
    farm.stop();
  }));

  // lahan jauh -> bot stalking ke area, pesan info
  const farMessages = [];
  const farFarm = attachFarm(makeBot({ blockAt: () => null }), {
    farm: { enabled: true, area: { x: 500, y: 64, z: 500, radius: 4 }, walkToRadius: 24, maxWalkDistance: 1000, walkTimeoutMs: 100, walkStepMs: 10 }
  }, captureLogger(farMessages));
  pending.push(farFarm.harvest().then(() => {
    const info = farMessages.filter(([level]) => level === 'info').map(([, text]) => text).join(' | ');
    check('lahan jauh memicu pesan berjalan', /berjalan ke sana/.test(info), info.slice(0, 140));
    check('lahan jauh tercatat di statistik', farFarm.stats.walks === 1, String(farFarm.stats.walks));
    farFarm.stop();
  }));

  // pengaman: jangan jalan kalau koordinatclearly salah (ribuan blok)
  const lostMessages = [];
  const lostFarm = attachFarm(makeBot({ blockAt: () => null }), {
    farm: { enabled: true, area: { x: 10992, y: 64, z: 0, radius: 8 }, walkToRadius: 24, maxWalkDistance: 64 }
  }, captureLogger(lostMessages));
  pending.push(lostFarm.harvest().then(() => {
    check('tidak jalan ke lahan yang terlalu jauh', lostFarm.stats.walks === 0, String(lostFarm.stats.walks));
    const warn = lostMessages.filter(([level]) => level === 'warn').map(([, text]) => text).join(' | ');
    check('bantu cek koordinat area', /cek farm\.area/.test(warn), warn.slice(0, 160));
    check('default maxWalkDistance 64', maxWalkDistanceOf({}) === 64);
    check('maxWalkDistance 0 = tanpa batas', maxWalkDistanceOf({ maxWalkDistance: 0 }) === 0);
    lostFarm.stop();
  }));

  const zeroMessages = [];
  const zeroFarm = attachFarm(makeBot(), { farm: { enabled: true, area: { x: 0, y: 64, z: 0 } } }, captureLogger(zeroMessages));
  zeroFarm.start();
  check('tanpa area tetap nyala karena auto-cari lahan', zeroFarm.enabled === true);
  check('ada pesan mode cari lahan', zeroMessages.some(([, text]) => /mencari lahan di sekitar bot/.test(text)), zeroMessages.map((m) => m[1]).join(' | ').slice(0, 160));
  check('autoDiscover default on', zeroFarm.status().autoDiscover === true);
  zeroFarm.stop();
  // autoDiscover=false tanpa area -> fitur tetap dilewati
  const offMessages = [];
  const offFarm = attachFarm(makeBot(), { farm: { enabled: true, area: { x: 0, y: 64, z: 0 }, autoDiscover: false } }, captureLogger(offMessages));
  offFarm.start();
  check('autoDiscover=false tanpa area tidak nyala', offFarm.enabled === false);
  check('ada peringatan area belum diisi', offMessages.some(([level, text]) => level === 'warn' && /farm\.area/.test(text)));
}

process.stdout.write('\n');
process.stdout.write('[features] panen: alias nama tanaman\n');
{
  check('carrot -> carrots', normalizeCrops(['carrot']).has('carrots'));
  check('carrots -> carrots', normalizeCrops(['carrots']).has('carrots'));
  check('beetroot -> beetroots', normalizeCrops(['beetroot']).has('beetroots'));
  check('beetroot_seeds -> beetroots', normalizeCrops(['beetroot_seeds']).has('beetroots'));
  check('potato -> potatoes', normalizeCrops(['potato']).has('potatoes'));
  check('wheat_seeds -> wheat', normalizeCrops(['wheat_seeds']).has('wheat'));
  check('filter kosong -> default', normalizeCrops([]).has('carrots') && normalizeCrops(null).has('wheat'));
  check('countCropTypes', JSON.stringify(countCropTypes([{ crop: 'carrot' }, { crop: 'carrot' }, { crop: 'wheat' }])) === '{"carrot":2,"wheat":1}');
  const hoe = pickTool(makeBot({ inventory: { items: () => [{ name: 'diamond_hoe', count: 1 }, { name: 'stone_hoe', count: 1 }] } }), {});
  check('cangkul terbaik dipilih', hoe.name === 'diamond_hoe', String(hoe.name));
  check('tanpa cangkul = tangan', pickTool(makeBot(), {}).name === null);
  check('useTool=false disables cangkul', pickTool(makeBot({ inventory: { items: () => [{ name: 'diamond_hoe', count: 1 }] } }), { useTool: false }).name === null);
}

process.stdout.write('\n');
process.stdout.write('[features] panen: cari lahan otomatis di sekitar bot\n');
{
  const world = new Map();
  const put = (x, y, z, name) => world.set(`${x},${y},${z}`, name);
  // lahanwortel 6 blok di utara bot, di atas tanah sawah
  for (let x = 5; x <= 8; x += 1) {
    for (let z = 14; z <= 16; z += 1) {
      put(x, 63, z, 'farmland');
      put(x, 64, z, 'carrots');
    }
  }
  // tanaman liar di atas batu, harus diabaikan
  put(-3, 64, -3, 'carrots');
  put(-3, 63, -3, 'stone');

  const key = (position) => `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  const makeWorldBot = () => makeBot({
    blockAt: (position) => {
      const name = world.get(key(position));
      return name ? { name, position: position.floored() } : null;
    },
    entity: { id: 0, position: new Vec3(0.5, 64, 0.5), height: 1.8, yaw: 0, pitch: 0, health: 20, onGround: true }
  });

  const found = searchFarmArea(makeWorldBot(), { crops: ['carrots'], scanHeight: 2, searchRadius: 32 });
  check('lahan ditemukan', found !== null);
  check('lahan di tengah lahan', found.area.x === 7 && found.area.z === 15, JSON.stringify(found && found.area));
  check('radius lahan cukup', found.area.radius >= 3, String(found.area.radius));
  check('jumlah tanaman dihitung', found.crops.length === 12, String(found.crops.length));
  check('tanaman paling dekat dulu', found.crops[0].position.z >= 14.5, JSON.stringify(found.crops[0].position));
  check('tanaman di batu tidak ikut', found.crops.every((entry) => Math.hypot(entry.position.x - 0.5, entry.position.z - 0.5) > 5));
  check('ring ditentukan', found.ring === 14, String(found.ring));

  const tooSmall = searchFarmArea(makeWorldBot(), { crops: ['carrots'], searchRadius: 5 });
  check('radius kecil tidak menemukan lahan', tooSmall === null, String(tooSmall));
  check('searchRadius 0 mematikan pencarian', searchFarmArea(makeWorldBot(), { crops: ['carrots'], searchRadius: 0 }) === null);
  check('searchRadius dibatasi 64', searchRadiusOf({ searchRadius: 999 }) === 64);
  check('searchInterval minimal 5 detik', searchIntervalOf({ searchIntervalMs: 10 }) === 5000);

  const messages = [];
  const logger = captureLogger(messages);
  const bot = makeWorldBot();
  const farm = attachFarm(bot, {
    farm: { enabled: true, crops: ['carrots'], scanHeight: 2, searchRadius: 32, searchIntervalMs: 5000, harvestIntervalMs: 10, dropWaitMs: 60, dropStepMs: 30, pickupAttempts: 1, pickupStepMs: 10, approachAttempts: 1, approachStepMs: 10, reach: 30, replant: false }
  }, logger);
  pending.push(farm.harvest().then((done) => {
    check('siklus panen dari lahan yang ditemukan', done === 12, String(done));
    check('pencarian tercatat di statistik', farm.stats.searches === 1, String(farm.stats.searches));
    const foundLog = messages.filter(([, text]) => /lahan ditemukan di/.test(text));
    check('ada log lahan ditemukan', foundLog.length === 1, foundLog.map(([, text]) => text).join(' | ').slice(0, 160));
    check('log menyebut jumlah tanaman', /12 tanaman/.test(foundLog[0][1]), foundLog[0][1].slice(0, 160));
    const info = farm.status();
    check('status remembers lahan', info.discovered && info.discovered.z === 15, JSON.stringify(info.discovered));
    check('status melaporkan lahan terdekat', info.nearbyField && info.nearbyField.crops === 12, JSON.stringify(info.nearbyField));
    check('posisi bot tidak digeser saat jalan', bot.entity.position.x === 0.5 && bot.entity.position.z === 0.5, bot.entity.position.toString());
    farm.stop();
  }));
}

process.stdout.write('\n');
process.stdout.write('[features] panen: batal manual + hentikan pukul mob\n');
{
  const world = new Map();
  for (let x = 0; x <= 5; x += 1) {
    world.set(`${x},63,0`, 'farmland');
    world.set(`${x},64,0`, 'carrots');
  }
  const key = (position) => `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  let digs = 0;
  const bot = makeBot({
    blockAt: (position) => {
      const name = world.get(key(position));
      return name ? { name, position: position.floored() } : null;
    },
    dig: () => new Promise((resolve) => setTimeout(resolve, 200))
  });
  bot.dig = () => {
    digs += 1;
    return new Promise((resolve) => setTimeout(resolve, 200));
  };
  bot.inventory = { items: () => [{ name: 'iron_hoe', count: 1 }] };

  const messages = [];
  const farm = attachFarm(bot, {
    farm: {
      enabled: true, area: { x: 2, y: 64, z: 0, radius: 6 }, crops: ['carrots'],
      harvestIntervalMs: 10, dropWaitMs: 200, dropStepMs: 50,
      pickupAttempts: 1, pickupStepMs: 50, approachAttempts: 1, approachStepMs: 20, replant: false
    }
  }, captureLogger(messages));

  check('tidak ada panen saat belum jalan', farm.harvesting === false);
  check('batal saat idle mengembalikan false', farm.abortHarvest() === false);

  pending.push((async () => {
    const running = farm.harvest();
    await new Promise((resolve) => setTimeout(resolve, 80));
    check('ada panen yang sedang jalan', farm.harvesting === true);
    check('status menandai sedang panen', farm.status().harvesting === true);
    check('batal saat berjalan mengembalikan true', farm.abortHarvest() === true);

    const done = await running;
    check('siklus selesai, tidak menggantung', typeof done === 'number', String(done));
    check('sisa tanaman tidak dipanen', done < 6, String(done));
    check('flag berhenti turun setelah batal', farm.harvesting === false);
    check('jumlah batal tercatat', farm.aborts === 1, String(farm.aborts));
    check('ada log panen dihentikan', messages.some(([, text]) => /panen dihentikan/.test(text)), messages.map((m) => m[1]).join(' | ').slice(0, 160));

    const digsBefore = digs;
    const again = await farm.harvest();
    check('siklus berikutnya masih jalan', again > 0 && digs > digsBefore, `lagi=${again} dig=${digs}`);
    check('tidak ada harvest menggantung', farm.harvesting === false);

    // stop() juga harus melepas siklus yang sedang jalan
    const third = farm.harvest();
    setTimeout(() => farm.stop(), 60);
    const thirdDone = await third;
    check('stop() membatalkan siklus tanpa menggantung', typeof thirdDone === 'number', String(thirdDone));
    check('stop() mematikan auto-panen', farm.enabled === false);
    check('setEnabled(true) menyalakan lagi', (farm.setEnabled(true), farm.enabled === true));
    farm.stop();
  })());
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: hentikan lalu nyalakan lagi\n');
{
  const bot = makeBot();
  bot.entities = { 7: { id: 7, name: 'zombie', position: new Vec3(0.5, 64, 2), health: 20 } };
  bot.inventory = { items: () => [{ name: 'iron_sword', count: 1 }] };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0 }
  }, quietLogger());
  combat.start();
  check('target dicatat sebagai sedang menyerang', combat.fighting === true, String(combat.targetId));
  bot.hits.length = 0;
  combat.stop();
  check('stop mematikan loop', combat.enabled === false);
  check('stop menyimpan target', combat.fighting === false);
  check('tidak ada serangan setelah stop', bot.hits.length === 0, JSON.stringify(bot.hits));
  combat.tick();
  check('tick setelah stop tidak menyerang', bot.hits.length === 0, JSON.stringify(bot.hits));

  // listener entityDead harus dilepas, kalau tidak knock terhitung dobel
  combat.start();
  bot.emit('entityDead', bot.entities[7]);
  check('knock tidak dobel setelah start ulang', combat.stats.kills === 1, String(combat.stats.kills));
  combat.stop();
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: deteksi mob dari registry (versi 1.8 / 1.20+)\n');
{
  // 1.8+: registry menandai mob dengan type "hostile"
  check('mob baru versi 1.20 (breeze) dikenali', isHostile({ name: 'breeze', type: 'hostile' }) === true);
  check('bogged 1.21 dikenali', isHostile({ name: 'bogged', type: 'hostile', kind: 'Hostile mobs' }) === true);
  // 1.16 dan sebelumnya: category "Hostile mobs" dengan type "mob"
  check('category hostile dipakai', isHostile({ name: 'zombie', type: 'mob', kind: 'Hostile mobs' }) === true);
  // 1.8: nama mob huruf kapital
  check('nama kapital 1.8 dikenali', isHostile({ name: 'Zombie', type: 'mob', kind: 'Hostile mobs' }) === true);
  check('nama kapital dengan spasi dikenali', isHostile({ name: 'Cave Spider' }) === true);
  check('nama 1.8 pigzombie dikenali', isHostile({ name: 'PigZombie' }) === true);
  // non-mob tidak boleh dipukul walau namanya mirip
  check('blok tidak dipukul', isHostile({ name: 'grass_block', type: 'object', kind: 'Blocks' }) === false);
  check('item drop tidak dipukul', isHostile({ name: 'item', type: 'object' }) === false);
  check('panah tidak dipukul', isHostile({ name: 'arrow', type: 'projectile', kind: 'Projectiles' }) === false);
  // sekutu dan hewan tidak masuk daftar hostile
  check('iron golem tidak diserang', isHostile({ name: 'iron_golem', kind: 'Passive mobs' }) === false);
  check('snow golem tidak diserang', isHostile({ name: 'snow_golem', kind: 'Passive mobs' }) === false);
  check('ikan tidak diserang', isHostile({ name: 'cod', kind: 'Passive mobs' }) === false);
  check('strider tidak diserang', isHostile({ name: 'strider', kind: 'Passive mobs' }) === false);
  check('pig tidak diserang', isHostile({ name: 'pig', type: 'animal', kind: 'Passive mobs' }) === false);
  check('villager tidak diserang walau registry bilang mob', isHostile({ name: 'villager', type: 'passive' }) === false);
  check('normalizeName unify format', normalizeName('Zombie Villager') === 'zombievillager' && normalizeName('zombie_villager') === 'zombievillager');
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: jangkauan pukul yang benar\n');
{
  const bot = makeBot();
  const near = { id: 1, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 2) };
  const above = { id: 2, name: 'zombie', height: 1.95, position: new Vec3(0.5, 68, 0.5) };
  const far = { id: 3, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 6) };
  check('mob 2 blok di depan = dalam jangkauan', withinReach(bot, near, 3) === true);
  check('mob 5 blok = luar jangkauan', withinReach(bot, far, 3) === false);
  check('mob 4 blok di atas kepala = luar jangkauan', withinReach(bot, above, 3) === false);
  check('tanpa entity = bukan jangkauan', withinReach(bot, null, 3) === false);
  bot.entities = { 1: above };
  check('mob di atas tidak dikira sudah dipukul', planCombat(bot, { range: 12 }).action === 'approach');
  bot.entities = { 1: near };
  check('mob dekat tetap dipukul', planCombat(bot, { range: 12 }).action === 'attack');
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: target tidak berpindah-pindah\n');
{
  const messages = [];
  const bot = makeBot();
  bot.entities = {
    1: { id: 1, name: 'zombie', height: 1.95, position: new Vec3(1, 64, 0) },
    2: { id: 2, name: 'skeleton', height: 1.95, position: new Vec3(-1, 64, 0) }
  };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0 }
  }, captureLogger(messages));
  combat.start();
  const firstTarget = combat.targetId;
  combat.tick();
  combat.tick();
  check('target sama saat jaraknya sama', combat.targetId === firstTarget, String(combat.targetId));
  const newTargetLogs = messages.filter(([, text]) => /target baru/.test(text));
  check('log target baru tidak diulang tiap tick', newTargetLogs.length === 1, String(newTargetLogs.length));
  // target yang hilang dari entities dilepas supaya bot tidak attack ke entity mati
  bot.entities = { 2: bot.entities[2] };
  combat.tick();
  check('target hilang dilepas', combat.targetId === 2, String(combat.targetId));
  combat.stop();
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: knock hanya dari target yang dilawan\n');
{
  const bot = makeBot();
  bot.entities = {
    1: { id: 1, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 2) },
    2: { id: 2, name: 'chicken', height: 0.7, position: new Vec3(0.5, 64, -2) }
  };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0 }
  }, quietLogger());
  combat.start();
  bot.emit('entityDead', bot.entities[2]);
  check('kematian entity lain tidak dihitung', combat.stats.kills === 0, String(combat.stats.kills));
  bot.emit('entityDead', bot.entities[1]);
  check('knock target dihitung', combat.stats.kills === 1, String(combat.stats.kills));
  // tidak ada target aktif: entityGone tidak boleh menambah apa pun
  bot.emit('entityDead', bot.entities[2]);
  check('tanpa target tidak ada knock tambahan', combat.stats.kills === 1, String(combat.stats.kills));
  combat.stop();
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: mundur saat HP rendah (sekali saja)\n');
{
  const messages = [];
  const bot = makeBot();
  bot.health = 4;
  bot.entities = { 3: { id: 3, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 2) } };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0, retreatBelowHealth: 6 }
  }, captureLogger(messages));
  bot.hits.length = 0;
  bot.moves.length = 0;
  combat.start();
  bot.moves.length = 0;
  combat.tick();
  check('tidak menyerang saat HP rendah', bot.hits.length === 0, JSON.stringify(bot.hits));
  check('mundur dipakai', bot.moves.includes('back'), JSON.stringify(bot.moves));
  check('retreat dihitung sekali', combat.stats.retreats === 1, String(combat.stats.retreats));
  bot.moves.length = 0;
  combat.tick();
  const warns = messages.filter(([, text]) => /HP rendah/.test(text));
  check('log HP rendah tidak spam', warns.length === 1, String(warns.length));
  check('retreat tidak dihitung ulang', combat.stats.retreats === 1, String(combat.stats.retreats));
  bot.health = 20;
  combat.tick();
  check('balik menyerang setelah HP pulih', bot.hits.length === 1, JSON.stringify(bot.hits));
  combat.stop();
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: menyerah kalau target tidak bisa didekati\n');
{
  // Timeout macet dihitung dari jam nyata, jadi jamnya dimock supaya tes ini
  // cepat dan tidak memakai timer sungguhan.
  const messages = [];
  const bot = makeBot();
  bot.entities = {
    5: { id: 5, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 6.5) },
    6: { id: 6, name: 'creeper', height: 1.7, position: new Vec3(0.5, 64, 5) }
  };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0, stuckTimeoutMs: 1200, giveUpMs: 60000 }
  }, captureLogger(messages));
  bot.moves.length = 0;
  bot.hits.length = 0;
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    combat.start();
    check('target pertama creeper yang paling dekat', combat.targetId === 6, String(combat.targetId));
    // bot tidak bergerak sama sekali (misalnya ada tembok): coba lompat dulu
    now += 700;
    combat.tick();
    check('lompat dicoba saat terhalang', bot.moves.includes('jump'), JSON.stringify(bot.moves));
    check('belum menyerah sebelum timeout', combat.targetId === 6, String(combat.targetId));
    // timeout habis: target dicoret supaya bot tidak pursue tanpa henti
    now += 700;
    combat.tick();
    check('target macet di-blacklist', combat.blacklisted.includes(6), JSON.stringify(combat.blacklisted));
    check('target macet dihitung di statistik', combat.stats.stuck === 1, String(combat.stats.stuck));
    const stuckLogs = messages.filter(([, text]) => /tidak bisa mendekati/.test(text));
    check('log target macet ada', stuckLogs.length === 1, String(stuckLogs.length));
    combat.tick();
    check('target pindah ke mob yang bisa dicapai', combat.targetId === 5, String(combat.targetId));
    check('tidak ada pukulan sia-sia', bot.hits.length === 0, JSON.stringify(bot.hits));
    bot.entities[5].position = new Vec3(0.5, 64, 2);
    combat.tick();
    check('mob yang bisa dicapai dipukul', bot.hits.length === 1, JSON.stringify(bot.hits));
  } finally {
    Date.now = realNow;
    combat.stop();
  }
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: bot mondar-mandir tetap dihitung macet\n');
{
  // Bug yang dikeluhkan: target terdeteksi 11,8 blok tapi tidak pernah dipukul.
  // Penyebabnya bot terus bergerak (bot.moves berisi forward tiap tick) tanpa
  // pernah benar-benar mendekat, jadi deteksi macet berbasis "bot bergerak"
  // menganggapnya progres. Sekarang progres diukur dari jarak ke mob.
  const messages = [];
  const bot = makeBot();
  bot.entities = {
    1: { id: 1, name: 'skeleton', height: 1.99, position: new Vec3(0.5, 64, 12.3) }
  };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0, stuckTimeoutMs: 1200, giveUpMs: 60000 }
  }, captureLogger(messages));
  bot.moves.length = 0;
  bot.hits.length = 0;
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    combat.start();
    check('jarak target dicatat untuk diagnosa', combat.stats.action === 'approach' && combat.stats.distance > 11, `${combat.stats.action} ${combat.stats.distance}`);
    // Bot jalan terus tapi nyebrangan kecil-kecil: banyak gerak, nol progres.
    for (const x of [0.7, 0.5]) {
      bot.entity.position = new Vec3(x, 64, 0.5);
      now += 700;
      combat.tick();
    }
    check('bot bergerak tapi tidak maju', bot.moves.length >= 2, JSON.stringify(bot.moves));
    check('target macet walau bot bergerak', combat.blacklisted.includes(1), JSON.stringify(combat.blacklisted));
    check('macet dihitung di statistik', combat.stats.stuck === 1, String(combat.stats.stuck));
    const stuckLog = messages.filter(([, text]) => /tidak bisa mendekati/.test(text));
    check('log macet menyebut jarak target', stuckLog.length === 1 && /jarak/.test(stuckLog[0][1]), stuckLog.map(([, t]) => t).join(' | '));
    check('tidak ada pukulan sia-sia', bot.hits.length === 0, JSON.stringify(bot.hits));
  } finally {
    Date.now = realNow;
    combat.stop();
  }
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: mode approach=false (diam di tempat, spam)\n');
{
  // Keluhan: bot gagal mendekati skeleton laludicoret/blacklist. Di mode ini
  // bot tidak pernah bergerak: mob yang terlihat langsung dipukul dari posisi
  // bot, spam sampai mati, dan tidak pernah masuk daftar target yang dicoret.
  const botStand = () => {
    const stand = makeBot();
    stand.entities = { 1: { id: 1, name: 'skeleton', height: 1.99, position: new Vec3(0.5, 64, 10.5) } };
    return stand;
  };
  check('jarak jauh tetap dipukul', planCombat(botStand(), { range: 12, approach: false }).action === 'attack');
  const far = planCombat(botStand(), { range: 12, approach: false, attackRange: 2 });
  check('jarak jauh ditandai belum jangkauan', far.inReach === false && far.stand === true, JSON.stringify(far.inReach));
  check('approach default tetap mendekat', planCombat(botStand(), { range: 12 }).action === 'approach');

  const messages = [];
  const bot = makeBot();
  bot.entities = {
    1: { id: 1, name: 'skeleton', height: 1.99, position: new Vec3(0.5, 64, 10.5) }
  };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, approach: false, attackRange: 2, intervalMs: 100000, attackCooldownMs: 0 }
  }, captureLogger(messages));
  bot.moves.length = 0;
  bot.hits.length = 0;
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    combat.start();
    check('target langsung dipukul tanpa mendekat', bot.hits.length === 1, JSON.stringify(bot.hits));
    check('bot tidak bergerak sama sekali', !bot.moves.includes('forward') && !bot.moves.includes('sprint'), JSON.stringify(bot.moves));
    check('aksi tercatat sebagai serang', combat.stats.action === 'attack' && combat.stats.distance >= 10, `${combat.stats.action} ${combat.stats.distance}`);
    // Lama sekali di posisi yang sama: bot diam, tapi target tidak dicoret.
    for (let i = 0; i < 12; i += 1) {
      now += 700;
      combat.tick();
    }
    check('spam terus jalan', bot.hits.length === 13, String(bot.hits.length));
    check('target tidak pernah di-blacklist', combat.blacklisted.length === 0, JSON.stringify(combat.blacklisted));
    check('tidak ada log "tidak bisa mendekati"', messages.filter(([, text]) => /tidak bisa mendekati/.test(text)).length === 0);
    // Mob mendekati sendiri sampai 2 blok: ayunan mulai kena.
    bot.entities[1].position = new Vec3(0.5, 64, 2);
    now += 700;
    combat.tick();
    check('masih memegang target yang sama', combat.targetId === 1, String(combat.targetId));
    check('jarak 2 blok = dalam jangkauan', combat.stats.distance <= 2, String(combat.stats.distance));
    check('target mati dihitung knock', (bot.emit('entityDead', bot.entities[1]), combat.stats.kills) === 1, String(combat.stats.kills));
    delete bot.entities[1];
    combat.tick();
    check('tanpa target kembali idle', combat.stats.action === 'idle' && combat.fighting === false, combat.stats.action);
  } finally {
    Date.now = realNow;
    combat.stop();
  }
}

process.stdout.write('\n');
process.stdout.write('[features] panen: relinquish control gerak saat auto-combat mengejar\n');
{
  // Auto-panen dan auto-combat berebut setControlState('forward'). Kalau keduanya
  // jalan, bot mondar-mandir dan combat tidak pernah sampai ke mob, jadi farm
  // harus melepas kontrol gerak selama duel.
  const world = new Map();
  for (let x = 0; x <= 3; x += 1) {
    world.set(`${x},63,0`, 'farmland');
    world.set(`${x},64,0`, 'carrots');
  }
  const key = (position) => `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  let digs = 0;
  const bot = makeBot({
    blockAt: (position) => {
      const name = world.get(key(position));
      return name ? { name, position: position.floored() } : null;
    }
  });
  bot.dig = () => {
    digs += 1;
    return Promise.resolve();
  };
  bot.inventory = { items: () => [{ name: 'iron_hoe', count: 1 }] };

  const messages = [];
  let busy = false;
  const farm = attachFarm(bot, {
    farm: {
      enabled: true, area: { x: 1, y: 64, z: 0, radius: 4 }, crops: ['carrots'],
      harvestIntervalMs: 10, dropWaitMs: 10, dropStepMs: 10, pickupAttempts: 1,
      pickupStepMs: 10, approachAttempts: 1, approachStepMs: 10, replant: false
    }
  }, captureLogger(messages), { combatBusy: () => busy });

  busy = true;
  bot.moves.length = 0;
  pending.push((async () => {
    const done = await farm.harvest();
    check('siklus panen dilewati saat combat aktif', done === 0, String(done));
    check('tidak ada digging saat combat aktif', digs === 0, String(digs));
    check('tidak ada gerakan farm', bot.moves.length === 0, JSON.stringify(bot.moves));
    check('ada log alasan jelas', messages.some(([, text]) => /auto-combat/.test(text)), messages.map(([, t]) => t).join(' | ').slice(0, 160));
    // duel selesai: farm lanjut seperti biasa
    busy = false;
    const after = await farm.harvest();
    check('panen jalan lagi setelah duel selesai', after === 4, String(after));
    check('tanaman dipotong setelah duel selesai', digs === 4, String(digs));
    farm.stop();
  })());
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: bidikan kaki + rotasi terkirim sebelum mengayun\n');
{
  // Bug: animasi mengayun tapi damage 0. Server cuma menerima pukulan kalau arah
  // pandang bot memotong hitbox mob, jadi (1) arahkan ke kaki, bukan mendatar,
  // dan (2) tunggu rotasi terkirim di physics tick sebelum attack dikirim.
  const bot = makeBot();
  bot.entity.eyeHeight = 1.62;
  bot.entities = { 3: { id: 3, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 3) } };
  const looks = [];
  bot.lookAt = (point, force) => {
    looks.push({ y: point.y, force });
    return Promise.resolve();
  };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0 }
  }, quietLogger());
  combat.start();
  check('arah pandang diarahkan ke kaki mob', looks.length >= 1 && looks[0].y === 64.8, JSON.stringify(looks[0]));
  check('bidikan dipaksa (tidak animasi halus)', looks[0].force === true, String(looks[0].force));
  check('bidikan kaki dicatat di statistik', combat.stats.aimHeight === 0.8, String(combat.stats.aimHeight));
  check('tetap menyerang', bot.hits.includes(3), JSON.stringify(bot.hits));
  combat.stop();

  // aimHeight custom = pinggang, dan tidak boleh keluar dari hitbox.
  const waist = makeBot();
  waist.entity.eyeHeight = 1.62;
  waist.entities = { 5: { id: 5, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 3) } };
  const points = [];
  waist.lookAt = (point) => { points.push(point.y); return Promise.resolve(); };
  const waistCombat = attachCombat(waist, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0, aimHeight: 0.9 }
  }, quietLogger());
  waistCombat.start();
  check('aimHeight custom dipakai', points[0] === 64.9, String(points[0]));
  waistCombat.stop();

  const high = makeBot();
  high.entity.eyeHeight = 1.62;
  high.entities = { 6: { id: 6, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 3) } };
  const highPoints = [];
  high.lookAt = (point) => { highPoints.push(point.y); return Promise.resolve(); };
  const highCombat = attachCombat(high, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0, aimHeight: 99 }
  }, quietLogger());
  highCombat.start();
  check('aimHeight tidak keluar dari hitbox', highPoints[0] === 65.85, String(highPoints[0]));
  highCombat.stop();

  // Rotasi harus dikirim dulu: dengan emit physicsTick manual, ayunan kedua
  // baru jalan setelah tick itu. Tanpa wait, attack mendahului rotasi dan
  // damage-nya ditolak server.
  const late = makeBot();
  late.entity.eyeHeight = 1.62;
  late.entities = { 4: { id: 4, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 2.5) } };
  late.lookAt = () => Promise.resolve();
  const lateCombat = attachCombat(late, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0 }
  }, quietLogger());
  lateCombat.start();
  check('swing pertama langsung jalan', late.hits.length === 1, JSON.stringify(late.hits));
  pending.push((async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    check('tidak mengayun sebelum rotasi terkirim', late.hits.length === 1, JSON.stringify(late.hits));
    late.emit('physicsTick');
    await new Promise((resolve) => setTimeout(resolve, 10));
    check('ayunan lanjut setelah physics tick', late.hits.length === 2, JSON.stringify(late.hits));
    // Physics tick diulang seperti bot asli: ayunan tidak mandek.
    for (let i = 0; i < 4; i += 1) {
      late.emit('physicsTick');
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    check('ayunan tetap jalan tanpa menggantung', late.hits.length > 2, JSON.stringify(late.hits));
    lateCombat.stop();
  })());
}

process.stdout.write('\n');
process.stdout.write('[features] afk: aksi idle dilewati saat auto-combat duel\n');
{
  // Aksi AFK memutar kepala acak + jalan. Kalau jalan saat auto-combat
  // membidik kaki mob, arah pandang berubah dan damage ayunan berikutnya 0.
  const { attachBehaviors } = require('../lib/behaviors');
  const bot = makeBot();
  bot.blockAt = () => ({ name: 'stone' });
  bot.entity.onGround = true;
  let busy = false;
  const config = {
    afk: { mode: 'idle', yawStepDeg: 30, pitchMinDeg: -20, pitchMaxDeg: 20, jumpChance: 1, swingArm: true, minIntervalMs: 100000, maxIntervalMs: 100000 },
    survival: { autoEat: false, eatBelowFood: 0, eatBelowHealth: 0, rescue: false, lowHealthQuit: 0 }
  };
  const behavior = attachBehaviors(bot, config, quietLogger(), { combatBusy: () => busy });
  const yawBefore = bot.entity.yaw;
  const pitchBefore = bot.entity.pitch;
  const idleBefore = behavior.stats.idleActions;
  behavior.idleAction();
  check('idle action jalan saat tidak ada duel', behavior.stats.idleActions === idleBefore + 1, String(behavior.stats.idleActions));
  check('kepala diputar saat tidak ada duel', bot.entity.yaw !== yawBefore || bot.entity.pitch !== pitchBefore,
    `yaw ${yawBefore.toFixed(2)} -> ${bot.entity.yaw.toFixed(2)}`);
  const yawLocked = bot.entity.yaw;
  const pitchLocked = bot.entity.pitch;
  busy = true;
  const idleDuring = behavior.stats.idleActions;
  behavior.idleAction();
  check('idle action dilewati saat duel', behavior.stats.idleActions === idleDuring, String(behavior.stats.idleActions));
  check('arah pandang tidak diganggu saat duel', bot.entity.yaw === yawLocked && bot.entity.pitch === pitchLocked,
    `yaw ${yawLocked.toFixed(2)} pitch ${pitchLocked.toFixed(2)}`);
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: bot mati dan respawn\n');
{
  const bot = makeBot();
  bot.entities = { 7: { id: 7, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 2) } };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0 }
  }, quietLogger());
  combat.start();
  bot.health = 0;
  bot.hits.length = 0;
  bot.moves.length = 0;
  combat.tick();
  check('bot mati tidak menyerang', bot.hits.length === 0, JSON.stringify(bot.hits));
  check('bot mati tidak bergerak', bot.moves.length === 0, JSON.stringify(bot.moves));
  bot.emit('death');
  check('target dibersihkan saat mati', combat.fighting === false, String(combat.targetId));
  bot.health = 20;
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  bot.emit('spawn');
  check('respawn lanjut menyerang', combat.tick() === undefined && bot.hits.length === 1, JSON.stringify(bot.hits));
  combat.stop();
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: senjata gagal dipegang lalu dicoba lagi\n');
{
  const bot = makeBot();
  bot.entities = { 9: { id: 9, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 2) } };
  let equips = 0;
  bot.inventory = {
    items: () => [{ name: 'stone_sword', count: 1 }]
  };
  bot.equip = () => {
    equips += 1;
    return Promise.reject(new Error('inventory penuh'));
  };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0 }
  }, quietLogger());
  bot.hits.length = 0;
  combat.start();
  check('pukulan tetap jalan walau equip gagal', bot.hits.length === 1, JSON.stringify(bot.hits));
  pending.push((async () => {
    await Promise.resolve();
    await Promise.resolve();
    combat.tick();
    await Promise.resolve();
    await Promise.resolve();
    check('equip dicoba ulang setelah gagal', equips >= 2, `equips=${equips}`);
    combat.stop();
  })());
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: senjata dipegang sebelum mob dalam jangkauan\n');
{
  // Bug yang dikeluhkan: pedang baru dipegang saat ayunan pertama, padahal
  // mindahin item itu butuh beberapa round trip. Jadi saat mob masih jauh,
  // tangan harus sudah berisi pedang.
  const bot = makeBot();
  bot.entities = { 4: { id: 4, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 9) } };
  bot.inventory = { items: () => [{ name: 'dirt', count: 12 }, { name: 'iron_sword', count: 1 }] };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 100 }
  }, quietLogger());
  bot.hits.length = 0;
  combat.start();
  check('mob jauh belum dipukul', bot.hits.length === 0, JSON.stringify(bot.hits));
  check('pedang dipegang saat masih mendekat', bot.held === 'iron_sword', String(bot.held));
  pending.push((async () => {
    await Promise.resolve();
    await Promise.resolve();
    check('senjata tercatat di statistik', combat.stats.weapon === 'iron_sword', String(combat.stats.weapon));
    check('handle melaporkan senjata', combat.weapon === 'iron_sword', String(combat.weapon));
    combat.stop();
  })());
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: tidak klik ulang kalau tangan sudah benar\n');
{
  const bot = makeBot();
  bot.entities = { 5: { id: 5, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 2) } };
  bot.inventory = { items: () => [{ name: 'iron_sword', count: 1 }] };
  bot.heldItem = { name: 'iron_sword', count: 1, slot: 36, type: 1 };
  let equips = 0;
  bot.equip = () => {
    equips += 1;
    return Promise.resolve();
  };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0 }
  }, quietLogger());
  combat.start();
  combat.tick();
  check('tangan sudah berisi senjata = tidak ada equip', equips === 0, `equips=${equips}`);
  check('senjata terbaca dari tangan', combat.weapon === 'iron_sword', String(combat.weapon));
  combat.stop();
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: equip ditolak server tanpa error -> dicoba lagi\n');
{
  const bot = makeBot();
  bot.entities = { 6: { id: 6, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 2) } };
  bot.inventory = { items: () => [{ name: 'iron_sword', count: 1 }] };
  bot.heldItem = null;
  let equips = 0;
  bot.equip = () => {
    equips += 1;
    return Promise.resolve();
  };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0, equipRetryMs: 0 }
  }, quietLogger());
  combat.start();
  pending.push((async () => {
    await Promise.resolve();
    await Promise.resolve();
    check('equip dicoba saat tangan kosong', equips === 1, `equips=${equips}`);
    // equip "sukses" tapi server tetap tidak menaruh senjata di tangan
    combat.tick();
    await Promise.resolve();
    await Promise.resolve();
    check('equip dicoba ulang saat tangan tetap kosong', equips === 2, `equips=${equips}`);
    combat.stop();
  })());
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: equip tidak diulang dalam jeda pengaman\n');
{
  const bot = makeBot();
  bot.entities = { 6: { id: 6, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 2) } };
  bot.inventory = { items: () => [{ name: 'iron_sword', count: 1 }] };
  bot.heldItem = null;
  let equips = 0;
  bot.equip = () => {
    equips += 1;
    return Promise.resolve();
  };
  const combat = attachCombat(bot, {
    combat: {
      enabled: true, range: 12, attackRange: 3, intervalMs: 100000, attackCooldownMs: 0, equipRetryMs: 60000
    }
  }, quietLogger());
  combat.start();
  pending.push((async () => {
    await Promise.resolve();
    await Promise.resolve();
    combat.tick();
    combat.tick();
    await Promise.resolve();
    await Promise.resolve();
    check('tidak membanjiri window klik', equips === 1, `equips=${equips}`);
    combat.stop();
  })());
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: kecepatan ayunan (auto clicker)\n');
{
  check('default 100ms = 10 CPS', attackInterval({}) === 100, String(attackInterval({})));
  check('nilai custom dipakai', attackInterval({ attackCooldownMs: 250 }) === 250);
  check('0 = spam tapi tidak spin', attackInterval({ attackCooldownMs: 0 }) === 25, String(attackInterval({ attackCooldownMs: 0 })));
  check('nilai tidak wajar dibatasi atas', attackInterval({ attackCooldownMs: 99999 }) === 2000);
  check('nilai rusak -> default', attackInterval({ attackCooldownMs: 'abc' }) === 100);
  check('scan tetap pakai intervalMs', scanInterval({ intervalMs: 500 }) === 500 && scanInterval({}) === 500);

  const bot = makeBot();
  bot.entities = { 7: { id: 7, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 9) } };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, attackRange: 3, intervalMs: 500, attackCooldownMs: 100 }
  }, quietLogger());
  combat.start();
  check('loop tetap lambat saat cuma mendekat', combat.interval === 500, String(combat.interval));
  bot.entities[7].position = new Vec3(0.5, 64, 2);
  combat.tick();
  check('loop cepat saat mengayun', combat.interval === 100, String(combat.interval));
  bot.entities = {};
  combat.tick();
  check('loop kembali lambat setelah mob habis', combat.interval === 500, String(combat.interval));
  combat.stop();
}

process.stdout.write('\n');
process.stdout.write('[features] pukul mob: CPS acak ala mod auto clicker (cpsMin/cpsMax)\n');
{
  check('tanpa cpsMin/cpsMax pakai jeda tetap', clickInterval({ attackCooldownMs: 100 }) === 100);
  check('cpsMin saja = click rate tetap', clickInterval({ attackCooldownMs: 100, cpsMin: 10 }) === 100);
  check('tanpa cpsMin -> bukan mode acak', cpsRange({ cpsMax: 14 }) === null);
  check('nilai rusak diabaikan', cpsRange({ cpsMin: 'abc', cpsMax: -1 }) === null);
  check('rentang terbalik dibalik sendiri', JSON.stringify(cpsRange({ cpsMin: 14, cpsMax: 8 })) === JSON.stringify({ min: 14, max: 14 }));
  check('batas atas kosong ikut batas bawah', JSON.stringify(cpsRange({ cpsMin: 8 })) === JSON.stringify({ min: 8, max: 8 }));

  // 8-14 CPS = jeda acak antara 1000/14 (71ms) dan 1000/8 (125ms).
  const acak = { cpsMin: 8, cpsMax: 14 };
  const fast = clickInterval(acak, () => 0);
  const mid = clickInterval(acak, () => 0.5);
  const slow = clickInterval(acak, () => 1);
  check('undian 0 = jeda tercepat', Math.abs(fast - 1000 / 14) < 0.01, String(fast));
  check('undian 1 = jeda terlama', Math.abs(slow - 1000 / 8) < 0.01, String(slow));
  check('undian tengah di tengah', Math.abs(mid - (fast + slow) / 2) < 0.01, String(mid));
  check('click rate dibatasi 40 CPS', clickInterval({ cpsMin: 1, cpsMax: 999 }, () => 0) === 25);
  check('click rate dibatasi 0,5 CPS', clickInterval({ cpsMin: 0.01, cpsMax: 0.01 }, () => 1) === 2000);
  check('label tetap untuk jeda tetap', cpsLabel({ attackCooldownMs: 100 }) === '10 CPS', cpsLabel({ attackCooldownMs: 100 }));
  check('label rentang CPS', cpsLabel(acak) === '8-14 CPS', cpsLabel(acak));

  // Math.random sungguhan: semua jeda harus tetap di dalam rentang, tidak keluar jalur.
  const samples = new Set();
  let outOfRange = false;
  for (let i = 0; i < 300; i += 1) {
    const value = clickInterval(acak);
    samples.add(value);
    if (value < fast - 0.001 || value > slow + 0.001) outOfRange = true;
  }
  check('jeda acak selalu di dalam rentang', !outOfRange, `contoh ${[...samples][0]}`);
  check('jeda acak tidak pernah tetap', samples.size > 200, `unik=${samples.size}`);

  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;

  // Loop mengundi jeda sekali lalu memakai angka yang sama untuk cooldown dan
  // jadwal berikutnya. Kalau angka itu diundi ulang, gap efektif jadi dua kali
  // lipatan dan CPS yang ditulis tidak pernah tercapai.
  const bot = makeBot();
  bot.entities = { 3: { id: 3, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 2) } };
  const combat = attachCombat(bot, {
    combat: { enabled: true, range: 12, approach: false, attackRange: 2, intervalMs: 100000, attackCooldownMs: 0, cpsMin: 8, cpsMax: 14 }
  }, quietLogger());
  bot.hits.length = 0;
  try {
    combat.start();
    now += 200;
    combat.tick(100);
    check('klik pertama masuk', bot.hits.length === 1, String(bot.hits.length));
    now += 60;
    combat.tick(100);
    check('klik kedua ditahan sampai gap lewat', bot.hits.length === 1, String(bot.hits.length));
    now += 60;
    combat.tick(100);
    check('klik berikutnya jalan setelah gap', bot.hits.length === 2, String(bot.hits.length));
    // Tick tiap 200ms selalu melewati gap terlama (125ms): satu klik per tick.
    for (let i = 0; i < 40; i += 1) {
      now += 200;
      combat.tick(clickInterval(acak));
    }
    check('satu klik per tick, tidak ada gap menggandakan', bot.hits.length === 42, String(bot.hits.length));
    const swingRate = combat.interval;
    check('periode loop tetap di rentang CPS', swingRate >= fast - 0.001 && swingRate <= slow + 0.001, String(swingRate));
  } finally {
    Date.now = realNow;
    combat.stop();
  }

  const fixed = makeBot();
  fixed.entities = { 4: { id: 4, name: 'zombie', height: 1.95, position: new Vec3(0.5, 64, 2) } };
  const fixedCombat = attachCombat(fixed, {
    combat: { enabled: true, range: 12, approach: false, attackRange: 2, intervalMs: 100000, attackCooldownMs: 0 }
  }, quietLogger());
  try {
    fixedCombat.start();
    for (let i = 0; i < 5; i += 1) {
      now += 10;
      fixedCombat.tick();
    }
    check('spam tanpa jeda tetap jedes tick', fixed.hits.length === 5, String(fixed.hits.length));
  } finally {
    Date.now = realNow;
    fixedCombat.stop();
  }
}

process.stdout.write('\n');
process.stdout.write('[features] panen: scan di jeda antar tanaman (cache)\n');
{
  const world = new Map();
  for (let x = 0; x <= 5; x += 1) {
    for (let z = 0; z <= 5; z += 1) {
      world.set(`${x},63,${z}`, 'farmland');
      world.set(`${x},64,${z}`, 'carrots');
    }
  }
  const key = (position) => `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  let lookups = 0;
  let digs = 0;
  const bot = makeBot();
  bot.blockAt = (position) => {
    if (!position) return null;
    lookups += 1;
    const name = world.get(key(position));
    return name ? { name, position: position.floored() } : null;
  };
  // tanaman tidak hilang setelah dig -> siklus berikutnya masih ada pekerjaan
  bot.dig = () => { digs += 1; return Promise.resolve(); };
  bot.inventory = { items: () => [{ name: 'iron_hoe', count: 1 }] };

  const farm = attachFarm(bot, {
    farm: {
      enabled: true, area: { x: 2, y: 64, z: 2, radius: 4 }, crops: ['carrots'],
      scanHeight: 2, reach: 30, scanIntervalMs: 15000,
      harvestIntervalMs: 5, dropWaitMs: 40, dropStepMs: 10,
      pickupAttempts: 1, pickupStepMs: 5, approachAttempts: 1, approachStepMs: 5,
      replant: false, autoDiscover: false,
      // siklus kedua sengaja menguji isolate cache, bukan cooldown panen
      harvestCooldownMs: 0
    }
  }, quietLogger());

  // volume satu scan penuh: 9 x 9 x 5 = 405 blok
  const perScan = 9 * 9 * 5;
  const total = 36;

  pending.push((async () => {
    const first = await farm.harvest();
    check('siklus pertama panen semua tanaman', first === total, String(first));
    check('siklus pertama cuma scan sekali', farm.stats.scans === 1, String(farm.stats.scans));
    check('tidak scan ulang per tanaman', lookups < total * perScan / 10, `${lookups} vs ${total * perScan}`);
    check('scan dicatat di statistik', farm.stats.lastScanAt > 0);

    const afterFirst = lookups;
    const second = await farm.harvest();
    check('siklus kedua tetap bisa panen', second === total, String(second));
    check('siklus kedua pakai cache, tanpa scan baru', farm.stats.scans === 1, String(farm.stats.scans));
    check('siklus kedua jauh lebih murah', lookups - afterFirst < afterFirst / 2, `${lookups - afterFirst} vs ${afterFirst}`);
    check('tanaman dig sesuai jumlah siklus', digs === total * 2, String(digs));

    // status tidak perlu scan ulang kalau cache masih segar
    const beforeStatus = lookups;
    const info = farm.status();
    check('status memakai cache', info.cachedCrops === true && lookups === beforeStatus, `${info.cachedCrops} ${lookups - beforeStatus}`);
    check('status jumlah tanaman benar', info.crops === total, String(info.crops));
    farm.stop();
  })());
}

process.stdout.write('\n');
process.stdout.write('[features] panen: jalan biasa tanpa lompat, panen sambil jalan\n');
{
  // Baris tanaman 4 blok, bot mulai di kiri. Bot "berjalan" sungguhan:
  // posisi cuma maju kalau control state forward menyala.
  const world = new Map();
  for (let x = 2; x <= 5; x += 1) {
    world.set(`${x},63,0`, 'farmland');
    world.set(`${x},64,0`, 'carrots');
  }
  const key = (position) => `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  const blockName = (position) => (position ? world.get(key(position)) || 'air' : 'air');
  const controls = { forward: false, sprint: false, jump: false };
  const moves = [];
  const bot = makeBot();
  bot.entity = { id: 0, position: new Vec3(-0.5, 64, 0.5), height: 1.8, yaw: 0, pitch: 0, health: 20, onGround: true };
  bot.blockAt = (position) => ({ name: blockName(position), position: position.floored() });
  bot.setControlState = (state, value) => {
    if (controls[state] === value) return;
    controls[state] = value;
    moves.push(`${state}=${value ? 1 : 0}`);
  };
  bot.stop = (state) => bot.setControlState(state, false);
  bot.look = (yaw) => { bot.entity.yaw = yaw; return Promise.resolve(); };
  bot.lookAt = (pos) => {
    const delta = pos.minus(bot.entity.position);
    bot.entity.yaw = Math.atan2(-delta.x, delta.z);
    return Promise.resolve();
  };
  bot.dig = (block) => {
    world.delete(key(block.position));
    bot.digs.push(key(block.position));
    return Promise.resolve();
  };
  bot.digs = [];
  bot.inventory = { items: () => [{ name: 'iron_hoe', count: 1 }, { name: 'carrot', count: 16 }] };
  bot.placeBlock = (reference) => {
    const p = reference.position.offset(0, 1, 0);
    world.set(key(p), 'carrots');
    return Promise.resolve();
  };

  const STEP = 20;
  const timer = setInterval(() => {
    if (!controls.forward) return;
    const ahead = new Vec3(
      bot.entity.position.x - Math.sin(bot.entity.yaw) * 0.9,
      bot.entity.position.y,
      bot.entity.position.z + Math.cos(bot.entity.yaw) * 0.9
    );
    if (blockName(ahead) !== 'air') { controls.forward = false; return; }
    const speed = controls.sprint ? 5.6 / 20 : 4.3 / 20;
    bot.entity.position = bot.entity.position.offset(-Math.sin(bot.entity.yaw) * speed, 0, Math.cos(bot.entity.yaw) * speed);
  }, STEP);

  const farm = attachFarm(bot, {
    farm: {
      enabled: true, area: { x: 3, y: 64, z: 0, radius: 5 }, crops: ['carrots'],
      scanHeight: 2, maxPerCycle: 0, reach: 3.2, walkToRadius: 0, autoDiscover: false,
      walkStepMs: STEP, cropWalkSteps: 200, harvestIntervalMs: 0,
      dropWaitMs: 20, dropStepMs: 10, pickupAttempts: 1, pickupStepMs: 10,
      approachAttempts: 4, approachStepMs: STEP, replant: true, useTool: true
    }
  }, quietLogger());

  pending.push((async () => {
    const done = await farm.harvest();
    clearInterval(timer);
    const jumps = moves.filter((entry) => entry === 'jump=1').length;
    const sprints = moves.filter((entry) => entry === 'sprint=1').length;
    const walked = moves.filter((entry) => entry === 'forward=1').length;
    check('satu siklus memotong semua tanaman', done === 4, String(done));
    check('tidak pernah lompat', jumps === 0, String(jumps));
    check('tidak pernah lari', sprints === 0, String(sprints));
    check('bot benar-benar jalan', walked > 1, String(walked));
    check('bot bergerak maju', bot.entity.position.x > 0.5, bot.entity.position.toString());
    check('tanaman dipotong di beberapa titik', new Set(bot.digs).size === 4, JSON.stringify(bot.digs));
    check('tanam ulang tetap jalan', farm.stats.replants === 4, String(farm.stats.replants));
    farm.stop();
  })());
}

process.stdout.write('\n');
process.stdout.write('[features] panen: rencana sinkron, hanya tanaman yang memang harus dipanen\n');
{
  // Dunia: gandum (TIDAK boleh dipanen) jadi pagar di sisi depan, wortel
  // (harus dipanen) di belakangnya. Bot mulai dari sisi gandum.
  const world = new Map();
  const put = (x, z, name) => { world.set(`${x},63,${z}`, 'farmland'); world.set(`${x},64,${z}`, name); };
  put(0, 0, 'wheat'); put(1, 0, 'wheat'); put(2, 0, 'wheat'); put(3, 0, 'wheat');
  put(0, 1, 'carrots'); put(1, 1, 'carrots'); put(2, 1, 'carrots'); put(3, 1, 'carrots');
  put(0, 2, 'carrots'); put(1, 2, 'carrots'); put(2, 2, 'carrots'); put(3, 2, 'carrots');
  const key = (position) => `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  const blockName = (position) => (position ? world.get(key(position)) || 'air' : 'air');
  const controls = { forward: false, sprint: false, jump: false };
  const bot = makeBot();
  bot.entity = { id: 0, position: new Vec3(0.5, 64, 1.5), height: 1.8, yaw: Math.PI, pitch: 0, health: 20, onGround: true };
  bot.blockAt = (position) => ({ name: blockName(position), position: position.floored() });
  bot.setControlState = (state, value) => { controls[state] = value; };
  bot.stop = (state) => { controls[state] = false; };
  bot.look = (yaw) => { bot.entity.yaw = yaw; return Promise.resolve(); };
  bot.lookAt = (pos) => {
    const delta = pos.minus(bot.entity.position);
    bot.entity.yaw = Math.atan2(-delta.x, delta.z);
    return Promise.resolve();
  };
  const dug = [];
  bot.dig = (block) => { world.delete(key(block.position)); dug.push(`${key(block.position)}=${block.name}`); return Promise.resolve(); };
  bot.inventory = { items: () => [{ name: 'iron_hoe', count: 1 }, { name: 'carrot', count: 16 }, { name: 'wheat_seeds', count: 16 }] };
  bot.placeBlock = (reference) => {
    const p = reference.position.offset(0, 1, 0);
    world.set(key(p), 'carrots');
    return Promise.resolve();
  };

  const STEP = 20;
  const timer = setInterval(() => {
    if (!controls.forward) return;
    const ahead = new Vec3(
      bot.entity.position.x - Math.sin(bot.entity.yaw) * 0.9,
      bot.entity.position.y,
      bot.entity.position.z + Math.cos(bot.entity.yaw) * 0.9
    );
    if (blockName(ahead) !== 'air') { controls.forward = false; return; }
    bot.entity.position = bot.entity.position.offset(-Math.sin(bot.entity.yaw) * 4.3 / 20, 0, Math.cos(bot.entity.yaw) * 4.3 / 20);
  }, STEP);

  const farm = attachFarm(bot, {
    farm: {
      enabled: true, area: { x: 1, y: 64, z: 1, radius: 4 }, crops: ['carrots'],
      scanHeight: 2, maxPerCycle: 0, reach: 3.2, walkToRadius: 0, autoDiscover: false,
      walkStepMs: STEP, cropWalkSteps: 40, harvestIntervalMs: 0,
      dropWaitMs: 20, dropStepMs: 10, pickupAttempts: 1, pickupStepMs: 10,
      approachAttempts: 4, approachStepMs: STEP, replant: true, useTool: true,
      harvestCooldownMs: 60000
    }
  }, quietLogger());

  pending.push((async () => {
    const done = await farm.harvest();
    clearInterval(timer);
    const wheatCut = dug.filter((entry) => entry.endsWith('=wheat')).length;
    check('gandum di luar rencana tidak pernah dipotong', wheatCut === 0, dug.join(' '));
    check('semua wortel di jangkauan dipanen', done === 8, String(done));
    check('semua lokasi wortel dipotong', new Set(dug.map((entry) => entry.split('=')[0])).size === 8, dug.join(' '));
    check('tanaman ditanam ulang', farm.stats.replants > 0, String(farm.stats.replants));

    // siklus berikutnya: semua tanaman baru saja dipanen, jadi tidak ada yang
    // boleh dipanen lagi walau sudah ditanam ulang
    const again = await farm.harvest();
    const after = dug.length;
    check('siklus kedua tidak memanen ulang tanaman yang baru dipanen', again === 0, String(again));
    check('siklus kedua tidak menggali apa pun', dug.length === after, dug.slice(after).join(' '));
    farm.stop();
  })());
}

process.stdout.write('\n');
process.stdout.write('[features] panen: cari jalan lain kalau ada yang ngehalangin\n');
{
  // Dunia datar berisi tanah, dengan tembok pemisah di x=3 (z -1..1).
  const world = new Map();
  const put = (x, y, z, name) => world.set(`${x},${y},${z}`, name);
  for (let x = -4; x <= 12; x += 1) {
    for (let z = -4; z <= 4; z += 1) put(x, 63, z, 'stone');
  }
  const blockName = (p) => world.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`) || 'air';
  const flatBot = (entities = {}) => ({
    entity: { id: 0, position: new Vec3(0.5, 64, 0.5), height: 1.8, yaw: 0, pitch: 0 },
    entities,
    blockAt: (p) => ({ name: blockName(p), position: p.floored() })
  });

  // tanpa tembok: rute lurus
  const clear = findPath(flatBot(), new Vec3(0.5, 64, 0.5), new Vec3(6.5, 64, 0.5), { reach: 1, radius: 16 });
  check('rute lurus ditemukan', Boolean(clear) && clear.length > 0, clear ? `${clear.length} langkah` : 'null');

  // tembok di tengah -> rute memutar, tidak menembus blok
  for (let z = -1; z <= 1; z += 1) {
    put(3, 64, z, 'cobblestone');
    put(3, 65, z, 'cobblestone');
  }
  const walled = findPath(flatBot(), new Vec3(0.5, 64, 0.5), new Vec3(6.5, 64, 0.5), { reach: 1, radius: 16 });
  check('tembok tetap punya rute lain', Boolean(walled) && walled.length > 0, walled ? `${walled.length} langkah` : 'null');
  check(
    'rute tidak menembus tembok',
    Boolean(walled) && walled.every((p) => !(Math.floor(p.x) === 3 && Math.abs(Math.floor(p.z)) <= 1)),
    walled ? JSON.stringify(walled.map((p) => `${p.x},${p.z}`)) : 'null'
  );

  // tanaman bukan penghalang, tanah kosong tanpa alas = tidak bisa dilewati
  put(6, 64, 0, 'carrots');
  put(6, 63, 0, 'farmland');
  check('tanaman bisa dilewati', isPassableBlock({ name: 'carrots' }) === true);
  check('batu bukan ruang bebas', isPassableBlock({ name: 'stone' }) === false);
  check('air bukan alas kaki', isGroundBlock({ name: 'air' }) === false);
  check('farmland alas kaki', isGroundBlock({ name: 'farmland' }) === true);
  const voidBot = {
    entity: { id: 0, position: new Vec3(0.5, 64, 0.5) },
    entities: {},
    blockAt: () => null
  };
  check('dunia belum dimuat -> tidak ada rute', findPath(voidBot, new Vec3(0.5, 64, 0.5), new Vec3(6.5, 64, 0.5), {}) === null);

  // orang berdiri persis di jalur -> rute disingkirkan
  for (let z = -1; z <= 1; z += 1) {
    world.delete(`${3},64,${z}`);
    world.delete(`${3},65,${z}`);
  }
  const crowded = findPath(
    flatBot({ 7: { id: 7, name: 'player', position: new Vec3(3.5, 64, 0.5) } }),
    new Vec3(0.5, 64, 0.5),
    new Vec3(6.5, 64, 0.5),
    { reach: 1, radius: 16 }
  );
  check(
    'player di jalur dibelah',
    Boolean(crowded) && crowded.every((p) => !(Math.floor(p.x) === 3 && Math.floor(p.z) === 0)),
    crowded ? JSON.stringify(crowded.map((p) => `${p.x},${p.z}`)) : 'null'
  );
  check('sel berpenghuni terdeteksi', cellBlockedBy(flatBot({ 7: { id: 7, name: 'zombie', position: new Vec3(3.5, 64, 0.5) } }), 3, 64, 0) === true);
  check('drop item bukan penghalang', cellBlockedBy(flatBot({ 8: { id: 8, name: 'item', position: new Vec3(3.5, 64, 0.5) } }), 3, 64, 0) === false);

  // --- agen: tembok menghalangi, bot tetap memanen lewat jalan memutar ---
  const harvestWorld = new Map(world);
  const hkey = (p) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
  const hName = (p) => harvestWorld.get(hkey(p)) || 'air';
  for (let z = -1; z <= 1; z += 1) {
    harvestWorld.set(`3,64,${z}`, 'cobblestone');
    harvestWorld.set(`3,65,${z}`, 'cobblestone');
  }
  const controls = { forward: false, sprint: false, jump: false };
  const moves = [];
  const bot = makeBot();
  bot.entity = { id: 0, position: new Vec3(0.5, 64, 0.5), height: 1.8, yaw: 0, pitch: 0, health: 20, onGround: true };
  bot.blockAt = (p) => ({ name: hName(p), position: p.floored() });
  bot.setControlState = (state, value) => {
    if (controls[state] === value) return;
    controls[state] = value;
    moves.push(`${state}=${value ? 1 : 0}`);
  };
  bot.stop = (state) => bot.setControlState(state, false);
  bot.look = (yaw) => { bot.entity.yaw = yaw; return Promise.resolve(); };
  bot.lookAt = (pos) => {
    const delta = pos.minus(bot.entity.position);
    bot.entity.yaw = Math.atan2(-delta.x, delta.z);
    return Promise.resolve();
  };
  const dug = [];
  bot.dig = (block) => { harvestWorld.delete(hkey(block.position)); dug.push(hkey(block.position)); return Promise.resolve(); };
  bot.inventory = { items: () => [{ name: 'iron_hoe', count: 1 }] };

  const STEP = 20;
  let maxSideStep = 0;
  const timer = setInterval(() => {
    maxSideStep = Math.max(maxSideStep, Math.abs(bot.entity.position.z - 0.5));
    if (!controls.forward) return;
    const ahead = new Vec3(
      bot.entity.position.x - Math.sin(bot.entity.yaw) * 0.9,
      bot.entity.position.y,
      bot.entity.position.z + Math.cos(bot.entity.yaw) * 0.9
    );
    if (hName(ahead) !== 'air') { controls.forward = false; return; }
    const speed = controls.sprint ? 5.6 / 20 : 4.3 / 20;
    bot.entity.position = bot.entity.position.offset(-Math.sin(bot.entity.yaw) * speed, 0, Math.cos(bot.entity.yaw) * speed);
  }, STEP);

  const farm = attachFarm(bot, {
    farm: {
      enabled: true, area: { x: 6, y: 64, z: 0, radius: 6 }, crops: ['carrots'],
      scanHeight: 2, reach: 3.2, walkToRadius: 0, autoDiscover: false,
      walkStepMs: STEP, cropWalkSteps: 0, harvestIntervalMs: 0,
      dropWaitMs: 40, dropStepMs: 20, pickupAttempts: 1, pickupStepMs: 10,
      approachAttempts: 4, approachStepMs: STEP, replant: false, useTool: true,
      pathRadius: 16
    }
  }, quietLogger());

  pending.push((async () => {
    const done = await farm.harvest();
    clearInterval(timer);
    check('panen tetap jalan walau ada tembok', done === 1, String(done));
    check('wortel terpotong', dug.includes('6,64,0'), JSON.stringify(dug));
    check('bot menempuh jalan memutar', maxSideStep > 1, `geser z ${maxSideStep.toFixed(2)} blok`);
    check('rute memutar dibuat', farm.stats.detours > 0, String(farm.stats.detours));
    check('tidak pernah lompat', !moves.includes('jump=1'), JSON.stringify(moves));
    farm.stop();
  })());
}

process.stdout.write('\n');
process.stdout.write('[features] config combat/shop/farm\n');

{
  const base = loadConfig([], {});
  check('default combat ada', Boolean(base.combat) && typeof base.combat.range === 'number');
  check('default shop ada', Boolean(base.shop) && base.shop.mode === 'gui');
  check('default farm ada', Boolean(base.farm) && typeof base.farm.enabled === 'boolean');
  // config.json bawaan: auto-panen menyala dan jalan terus sampai di-stop
  check('auto-panen menyala di config.json', base.farm.enabled === true, String(base.farm.enabled));
  check('maxPerCycle 0 = tanpa batas', base.farm.maxPerCycle === 0, String(base.farm.maxPerCycle));
  check('cropWalkSteps 0 = tanpa batas', base.farm.cropWalkSteps === 0, String(base.farm.cropWalkSteps));
  check('chaseRange 0 = tanpa batas', base.farm.chaseRange === 0, String(base.farm.chaseRange));
  check('pathRadius default 24', base.farm.pathRadius === 24, String(base.farm.pathRadius));
  check('default shop items array', Array.isArray(base.shop.items));

  const os = require('os');
  const path = require('path');
  const pure = loadConfig([], { MC_CONFIG: path.join(os.tmpdir(), 'tidak-ada-config-xyz.json') });
  check('combat default mati tanpa config file', pure.combat.enabled === false);
  check('shop default mati tanpa config file', pure.shop.enabled === false);
  check('farm default mati tanpa config file', pure.farm.enabled === false);
  check('combat default range 12', pure.combat.range === 12, String(pure.combat.range));

  const cli = loadConfig(['--combat', '--shop', '/shopmenu', '--farm'], {});
  check('CLI --combat menyalakan', cli.combat.enabled === true);
  check('CLI --shop menyalakan + command', cli.shop.enabled === true && cli.shop.command === '/shopmenu', cli.shop.command);
  check('CLI --farm menyalakan', cli.farm.enabled === true);

  const env = loadConfig([], { MC_COMBAT: '1', MC_SHOP: 'false', MC_FARM: 'on' });
  check('env MC_COMBAT menyalakan', env.combat.enabled === true);
  check('env MC_SHOP=false mematikan', env.shop.enabled === false);
  check('env MC_FARM menyalakan', env.farm.enabled === true);

  const badMode = loadConfig([], { MC_CONFIG_JSON: JSON.stringify({ shop: { mode: 'ngawur' } }) });
  check('shop mode ngawur -> gui', badMode.shop.mode === 'gui', badMode.shop.mode);
  const clamp = loadConfig([], {
    MC_CONFIG_JSON: JSON.stringify({ shop: { intervalMs: 10 }, farm: { scanIntervalMs: 1, maxPerCycle: -5 } })
  });
  check('interval shop dibatasi minimal', clamp.shop.intervalMs === 5000, String(clamp.shop.intervalMs));
  check('scanIntervalMs dibatasi minimal', clamp.farm.scanIntervalMs === 2000, String(clamp.farm.scanIntervalMs));
  check('maxPerCycle negatif -> 0', clamp.farm.maxPerCycle === 0, String(clamp.farm.maxPerCycle));

  check('default combat tanpa CPS acak', pure.combat.cpsMin === null && pure.combat.cpsMax === null, `${pure.combat.cpsMin}/${pure.combat.cpsMax}`);
  const cps = loadConfig([], { MC_CONFIG_JSON: JSON.stringify({ combat: { cpsMin: 8, cpsMax: 14 } }) });
  check('cpsMin/cpsMax diteruskan', cps.combat.cpsMin === 8 && cps.combat.cpsMax === 14, `${cps.combat.cpsMin}/${cps.combat.cpsMax}`);
  const cpsClamp = loadConfig([], { MC_CONFIG_JSON: JSON.stringify({ combat: { cpsMin: 0.01, cpsMax: 500 } }) });
  check('cps dibatasi 0,5-40', cpsClamp.combat.cpsMin === 0.5 && cpsClamp.combat.cpsMax === 40, `${cpsClamp.combat.cpsMin}/${cpsClamp.combat.cpsMax}`);
  const cpsSwap = loadConfig([], { MC_CONFIG_JSON: JSON.stringify({ combat: { cpsMin: 14, cpsMax: 8 } }) });
  check('rentang terbalik dirapikan', cpsSwap.combat.cpsMin === 14 && cpsSwap.combat.cpsMax === 14, `${cpsSwap.combat.cpsMin}/${cpsSwap.combat.cpsMax}`);
  const cpsBad = loadConfig([], { MC_CONFIG_JSON: JSON.stringify({ combat: { cpsMin: 'ngawur' } }) });
  check('cps rusak -> null (jatuh ke jeda tetap)', cpsBad.combat.cpsMin === null, String(cpsBad.combat.cpsMin));

  let threw = false;
  try {
    loadConfig([], { MC_CONFIG_JSON: JSON.stringify({ farm: { enabled: true, area: { x: 'abc', y: 64, z: 0 } } }) });
  } catch {
    threw = true;
  }
  check('farm.area ngawur ditolak', threw);
  const okArea = loadConfig([], { MC_CONFIG_JSON: JSON.stringify({ farm: { enabled: true, area: { x: '12', y: '70', z: '-8' } } }) });
  check('farm.area string angka diterima', okArea.farm.area.x === 12 && okArea.farm.area.z === -8, `${okArea.farm.area.x}/${okArea.farm.area.z}`);
}

process.stdout.write('\n');
process.stdout.write('[features] validasi profil combat/shop/farm\n');
{
  check('combat non-objek ditolak', validateProfile({ name: 'Azka01', combat: 'iya' }, 0).some((e) => e.includes('combat')));
  check('combat.enabled non-boolean ditolak', validateProfile({ name: 'Azka01', combat: { enabled: 'ya' } }, 0).some((e) => e.includes('enabled')));
  check('combat.range 0 ditolak', validateProfile({ name: 'Azka01', combat: { range: 0 } }, 0).some((e) => e.includes('combat.range')));
  check('shop mode ngawur ditolak', validateProfile({ name: 'Azka01', shop: { mode: 'ngawur' } }, 0).some((e) => e.includes('shop.mode')));
  check('shop.items bukan array ditolak', validateProfile({ name: 'Azka01', shop: { items: 'carrot' } }, 0).some((e) => e.includes('shop.items')));
  check('shop.items isi non-string ditolak', validateProfile({ name: 'Azka01', shop: { items: [1] } }, 0).some((e) => e.includes('shop.items')));
  check('farm.area non-objek ditolak', validateProfile({ name: 'Azka01', farm: { area: 5 } }, 0).some((e) => e.includes('farm.area')));
  check('farm.area tanpa x saat enabled ditolak', validateProfile({ name: 'Azka01', farm: { enabled: true, area: { y: 64, z: 0 } } }, 0).some((e) => e.includes('farm.area.x')));
  check('farm.area lengkap diterima', validateProfile({ name: 'Azka01', farm: { enabled: true, area: { x: 1, y: 2, z: 3 } } }, 0).length === 0);
  check('combat valid diterima', validateProfile({ name: 'Azka01', combat: { enabled: true, range: 10 } }, 0).length === 0);
  check('combat.cpsMin negatif ditolak', validateProfile({ name: 'Azka01', combat: { cpsMin: -5 } }, 0).some((e) => e.includes('combat.cpsMin')));
  check('combat.cpsMax string ditolak', validateProfile({ name: 'Azka01', combat: { cpsMax: 'cepat' } }, 0).some((e) => e.includes('combat.cpsMax')));
  check('combat.cps null diterima', validateProfile({ name: 'Azka01', combat: { cpsMin: 8, cpsMax: 14 } }, 0).length === 0);
}

process.stdout.write('\n');
process.stdout.write('[features] merge combat/shop/farm per profil\n');
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'featprof-'));
  const file = path.join(dir, 'p.json');
  fs.writeFileSync(file, JSON.stringify({
    defaults: {
      combat: { enabled: true, range: 12 },
      shop: { enabled: false, items: ['carrot'] },
      farm: { enabled: false, area: { x: 1, y: 64, z: 1, radius: 8 } }
    },
    profiles: [
      { name: 'Azka01' },
      { name: 'Azka02', shop: { enabled: true, mode: 'command' } },
      { name: 'Azka03', farm: { enabled: true, area: { x: 100, y: 70, z: 200 } } },
      { name: 'Azka04', overrides: { combat: { range: 20 } } }
    ]
  }));
  const by = Object.fromEntries(loadProfiles(file).profiles.map((p) => [p.name, p]));
  check('combat default ikut', by.Azka01.config.combat.enabled === true && by.Azka01.config.combat.range === 12);
  check('shop per-profil aktif', by.Azka02.config.shop.enabled === true && by.Azka02.config.shop.mode === 'command');
  check('shop items default kept', by.Azka02.config.shop.items[0] === 'carrot');
  check('farm per-profil aktif', by.Azka03.config.farm.enabled === true);
  check('farm area per-profil', by.Azka03.config.farm.area.x === 100 && by.Azka03.config.farm.area.z === 200);
  check('farm radius default kept', by.Azka03.config.farm.area.radius === 8, String(by.Azka03.config.farm.area.radius));
  check('overrides combat jalan', by.Azka04.config.combat.range === 20 && by.Azka04.config.combat.enabled === true);
  fs.rmSync(dir, { recursive: true, force: true });
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  process.stdout.write('\n');
  process.stdout.write(`[features] ${results.length - failed.length}/${results.length} passed\n`);
  process.exit(failed.length ? 1 : 0);
}

Promise.all(pending).then(finish, (err) => {
  check('promise test tidak reject', false, err.message);
  finish();
});