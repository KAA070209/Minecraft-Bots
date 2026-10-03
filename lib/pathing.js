'use strict';

const { Vec3 } = require('vec3');

const AIR_BLOCKS = new Set(['air', 'cave_air', 'void_air']);
const FLUID_BLOCKS = new Set(['water', 'flowing_water', 'lava', 'flowing_lava', 'bubble_column']);

// Tanaman dan tumbuhan tipis: kaki bot tetap bisa lewat, jadi bukan penghalang.
const THIN_BLOCKS = new Set([
  'carrots', 'potatoes', 'beetroots', 'wheat', 'nether_wart', 'cocoa', 'sweet_berry_bush',
  'stem', 'attached_melon_stem', 'attached_pumpkin_stem',
  'grass', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush',
  'dandelion', 'poppy', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
  'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'blue_orchid', 'allium', 'houstonia',
  'sunflower', 'lilac', 'rose_bush', 'peony', 'torchflower', 'pitcher_plant',
  'vine', 'glow_lichen', 'snow', 'water_lily_pad', 'sugar_cane', 'bamboo', 'kelp', 'kelp_plant',
  'sapling', 'red_mushroom', 'brown_mushroom', 'flower_pot', 'torch', 'wall_torch',
  'tripwire', 'tripwire_hook', 'string', 'rail', 'powered_rail', 'detector_rail', 'activator_rail',
  'redstone_wire', 'wheat_seeds', 'beetroot_seeds'
]);

// Entitas yang tidak pernah menghalangi jalan (drop item, proyektil, hiasan).
const IGNORED_ENTITIES = new Set([
  'item', 'xp_orb', 'experience_bottle', 'arrow', 'spectral_arrow', 'trident',
  'snowball', 'egg', 'ender_pearl', 'fireball', 'small_fireball', 'dragon_fireball',
  'wither_skull', 'painting', 'item_frame', 'glow_item_frame', 'armor_stand',
  'area_effect_cloud', 'falling_block', 'fishing_bobber', 'leash_knot', 'marker',
  'interaction', 'text_display', 'item_display', 'block_display', 'eye_of_ender'
]);

// Blok belum dimuat dianggap penghalang, supaya rute tidak menembus chunk kosong.
function isPassableBlock(block) {
  if (!block || !block.name) return false;
  if (FLUID_BLOCKS.has(block.name)) return false;
  if (block.boundingBox === 'block') return false;
  if (block.boundingBox === 'empty') return true;
  return AIR_BLOCKS.has(block.name) || THIN_BLOCKS.has(block.name);
}

function isGroundBlock(block) {
  if (!block || !block.name) return false;
  if (FLUID_BLOCKS.has(block.name)) return false;
  if (block.boundingBox) return block.boundingBox === 'block';
  return !AIR_BLOCKS.has(block.name) && !THIN_BLOCKS.has(block.name);
}

// Sel yang sedang diduduki mob/player. Ini yang bikin bot "nyangkut" di depan
// orang lain - pathfinder memberi biaya mahal pada sel ini supaya cari jalan
// lain, bukan menabrak.
function cellBlockedBy(bot, x, y, z) {
  if (!bot || !bot.entities) return false;
  const selfId = bot.entity ? bot.entity.id : null;
  for (const entity of Object.values(bot.entities)) {
    if (!entity || !entity.position) continue;
    if (entity.id === selfId) continue;
    // entity.objectType itu alias deprecated yang mencetak stack trace setiap
    // kali diakses, jadi pakai name/displayName yang diisi mineflayer.
    const name = entity.name || entity.displayName || null;
    if (!name || IGNORED_ENTITIES.has(name)) continue;
    if (typeof entity.health === 'number' && entity.health <= 0) continue;
    const dy = entity.position.y - y;
    if (Math.abs(dy) > 1.6) continue;
    const dx = entity.position.x - (x + 0.5);
    const dz = entity.position.z - (z + 0.5);
    if (dx * dx + dz * dz < 0.81) return true;
  }
  return false;
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].f <= items[i].f) break;
      const swap = items[parent];
      items[parent] = items[i];
      items[i] = swap;
      i = parent;
    }
  }

  pop() {
    const items = this.items;
    if (!items.length) return null;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let best = i;
        if (left < items.length && items[left].f < items[best].f) best = left;
        if (right < items.length && items[right].f < items[best].f) best = right;
        if (best === i) break;
        const swap = items[best];
        items[best] = items[i];
        items[i] = swap;
        i = best;
      }
    }
    return top;
  }
}

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// A* sederhana di atas grid blok. Tujuannya: kalau jalan lurus terhalang blok,
// mob, atau player, kembalikan rute memutar. Return null kalau memang tidak
// ada jalan (pemanggil lanjut pakai langkah biasa).
function findPath(bot, start, goal, opts = {}) {
  if (!bot || typeof bot.blockAt !== 'function' || !start || !goal) return null;
  const radius = Math.min(48, Math.max(4, Number(opts.radius) || 24));
  const reach = Math.max(0.5, Number(opts.reach) || 3.2);
  const jump = opts.jump === true;
  const maxNodes = Math.min(30000, Math.max(64, Number(opts.maxNodes) || 6000));

  const blockAt = (x, y, z) => {
    try {
      return bot.blockAt(new Vec3(x, y, z));
    } catch {
      return null;
    }
  };
  const passCache = new Map();
  const groundCache = new Map();
  const passable = (x, y, z) => {
    const key = `${x},${y},${z}`;
    let value = passCache.get(key);
    if (value === undefined) {
      value = isPassableBlock(blockAt(x, y, z));
      passCache.set(key, value);
    }
    return value;
  };
  const ground = (x, y, z) => {
    const key = `${x},${y},${z}`;
    let value = groundCache.get(key);
    if (value === undefined) {
      value = isGroundBlock(blockAt(x, y, z));
      groundCache.set(key, value);
    }
    return value;
  };
  const standable = (x, y, z) => passable(x, y, z) && passable(x, y + 1, z) && ground(x, y - 1, z);

  const sx = Math.floor(start.x);
  const sy = Math.floor(start.y);
  const sz = Math.floor(start.z);
  // posisi bot sendiri: badan harus lega, tanahnya bisa saja slab/tangga
  if (!passable(sx, sy, sz) || !passable(sx, sy + 1, sz)) return null;

  const minX = sx - radius;
  const maxX = sx + radius;
  const minZ = sz - radius;
  const maxZ = sz + radius;
  const minY = sy - 6;
  const maxY = sy + 3;
  const inside = (x, y, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ && y >= minY && y <= maxY;

  const distXZ = (x, z) => Math.hypot(x + 0.5 - goal.x, z + 0.5 - goal.z);
  const distY = (y) => Math.abs(y - goal.y);
  const heuristic = (x, y, z) => distXZ(x, z) + distY(y) * 0.5;
  const reached = (x, y, z) => distXZ(x, z) <= reach && distY(y) <= 1.5;

  const startKey = `${sx},${sy},${sz}`;
  const gScore = new Map([[startKey, 0]]);
  const parent = new Map();
  const closed = new Set();
  const heap = new MinHeap();
  heap.push({ x: sx, y: sy, z: sz, f: heuristic(sx, sy, sz) });
  let bestKey = startKey;
  let bestH = heuristic(sx, sy, sz);
  let expanded = 0;

  const neighbors = (x, y, z) => {
    const found = [];
    for (const [dx, dz] of STEPS) {
      const nx = x + dx;
      const nz = z + dz;
      if (!inside(nx, y, nz)) continue;
      // jalan datar
      if (standable(nx, y, nz)) found.push([nx, y, nz, 1]);
      // naik satu blok (butuh lompat)
      if (jump && passable(x, y + 2, z) && standable(nx, y + 1, nz)) found.push([nx, y + 1, nz, 1.6]);
      // turun: jatuh maksimal 3 blok, badan harus lega sepanjang jatuh
      for (let drop = 1; drop <= 3; drop += 1) {
        const ny = y - drop;
        if (ny < minY) break;
        if (!passable(nx, ny + 1, nz)) break;
        if (ground(nx, ny - 1, nz)) {
          found.push([nx, ny, nz, 1 + drop * 0.3]);
          break;
        }
      }
    }
    return found;
  };

  let node = heap.pop();
  while (node) {
    const key = `${node.x},${node.y},${node.z}`;
    if (closed.has(key)) {
      node = heap.pop();
      continue;
    }
    closed.add(key);
    expanded += 1;
    const h = heuristic(node.x, node.y, node.z);
    if (h < bestH) {
      bestH = h;
      bestKey = key;
    }
    if (reached(node.x, node.y, node.z)) return build(parent, key, startKey);
    if (expanded > maxNodes) break;
    const g = gScore.get(key) || 0;
    for (const [nx, ny, nz, cost] of neighbors(node.x, node.y, node.z)) {
      const nextKey = `${nx},${ny},${nz}`;
      if (closed.has(nextKey)) continue;
      const penalty = cellBlockedBy(bot, nx, ny, nz) ? 12 : 0;
      const nextG = g + cost + penalty;
      if (nextG >= (gScore.get(nextKey) === undefined ? Infinity : gScore.get(nextKey))) continue;
      gScore.set(nextKey, nextG);
      parent.set(nextKey, key);
      heap.push({ x: nx, y: ny, z: nz, f: nextG + heuristic(nx, ny, nz) });
    }
    node = heap.pop();
  }

  // goal di luar kotak pencarian: kembalikan rute sebagian yang paling dekat
  if (bestKey !== startKey) return build(parent, bestKey, startKey);
  return null;
}

function build(parent, endKey, startKey) {
  const path = [];
  let key = endKey;
  while (key && key !== startKey) {
    const [x, y, z] = key.split(',').map(Number);
    path.push(new Vec3(x + 0.5, y, z + 0.5));
    key = parent.get(key);
  }
  if (!path.length) return null;
  path.reverse();
  return path;
}

module.exports = { findPath, cellBlockedBy, isPassableBlock, isGroundBlock, MinHeap };
