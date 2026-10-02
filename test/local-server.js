'use strict';

const mc = require('minecraft-protocol');
const Chunk = require('prismarine-chunk')('1.16.3');
const Vec3 = require('vec3');

const PORT = parseInt(process.env.TEST_PORT || '25566', 10);
const VERSION = process.env.TEST_VERSION || '1.16';

const server = mc.createServer({
  'online-mode': false,
  host: '127.0.0.1',
  port: PORT,
  version: VERSION,
  keepAlive: false
});

const mcData = require('minecraft-data')(server.version);
const loginPacket = mcData.loginPacket;
const chunk = new Chunk(3);

for (let x = 0; x < 16; x += 1) {
  for (let z = 0; z < 16; z += 1) {
    for (let c = 0; c < 3; c += 1) {
      chunk.setBlockType(new Vec3(x, 100, z), mcData.blocksByName.grass_block.id, c);
      chunk.setBlockData(new Vec3(x, 100, z), 1, c);
      for (let y = 0; y < 256; y += 1) chunk.setSkyLight(new Vec3(x, y, z), 15, c);
    }
  }
}

let joins = 0;
const accounts = new Set();
const requireAuth = process.env.TEST_REQUIRE_AUTH === '1';
const onlineModeUser = process.env.TEST_ONLINE_MODE_USER || '';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

function say(client, text) {
  try {
    client.write('chat', { message: JSON.stringify({ text }), position: 1, sender: NIL_UUID });
  } catch (err) {
    process.stderr.write(`[test-server] gagal kirim chat: ${err.message}\n`);
  }
}

function setBlockAt(client, x, y, z, name) {
  const section = Math.floor(y / 16);
  const local = new Vec3(x & 15, y & 15, z & 15);
  chunk.setBlockType(local, mcData.blocksByName[name].id, section);
  chunk.setBlockData(local, 1, section);
  client.write('map_chunk', {
    x: Math.floor(x / 16),
    z: Math.floor(z / 16),
    groundUp: true,
    biomes: chunk.dumpBiomes !== undefined ? chunk.dumpBiomes() : undefined,
    heightmaps: { type: 'compound', name: '', value: {} },
    bitMap: chunk.getMask(),
    chunkData: chunk.dump(section),
    blockEntities: []
  });
}

server.on('playerJoin', (client) => {
  joins += 1;
  process.stdout.write(`[test-server] client ${client.id} join (${joins}), username=${client.username}\n`);
  client.registered = false;

  client.write('login', {
    ...loginPacket,
    entityId: client.id,
    isHardcore: false,
    gameMode: 1,
    previousGameMode: 255,
    worldName: 'minecraft:overworld',
    hashedSeed: [0, 0],
    maxPlayers: 20,
    viewDistance: 10,
    reducedDebugInfo: false,
    enableRespawnScreen: true,
    isDebug: false,
    isFlat: false
  });

  for (let c = 0; c < 3; c += 1) {
    client.write('map_chunk', {
      x: 0,
      z: 0,
      groundUp: true,
      biomes: chunk.dumpBiomes !== undefined ? chunk.dumpBiomes() : undefined,
      heightmaps: { type: 'compound', name: '', value: {} },
      bitMap: chunk.getMask(),
      chunkData: chunk.dump(c),
      blockEntities: []
    });
  }

  client.write('position', { x: 15.5, y: 101, z: 15.5, yaw: 137, pitch: 0, flags: 0x00 });
  client.write('update_health', { health: 20, food: 20, foodSaturation: 5 });

  if (onlineModeUser && client.username === onlineModeUser) {
    process.stdout.write(`[test-server] kick ${client.username}: online-mode\n`);
    setTimeout(() => {
      client.end('You are not logged into your Minecraft account. If you are logged into your Minecraft account, try restarting your Minecraft client.');
    }, 300);
    return;
  }

  if (requireAuth && accounts.has(client.username) && !client.registered) {
    setTimeout(() => {
      if (!client.registered) {
        process.stdout.write(`[test-server] kick ${client.username}: not registered\n`);
        client.end('You are not registered. Please register first.');
      }
    }, 8000);
  }

  client.on('packet', (data, meta) => {
    if (!meta || meta.name !== 'chat' || !data) return;
    const message = data.message;
    if (!message || !message.startsWith('/')) return;

    process.stdout.write(`[test-server] chat ${client.username}: ${message}\n`);

    if (message.startsWith('/register ')) {
      const parts = message.split(/\s+/);
      const password = parts[1];
      const confirm = parts[2];
      if (!password || !confirm) {
        say(client, 'Usage: /register <password> <confirmPassword>');
        return;
      }
      if (password !== confirm) {
        say(client, 'Passwords do not match!');
        return;
      }
      if (accounts.has(client.username)) {
        say(client, 'That name is already registered.');
        return;
      }
      accounts.add(client.username);
      client.registered = true;
      say(client, 'Successfully registered! You are now logged in.');
      process.stdout.write(`[test-server] registered ${client.username}\n`);
      return;
    }

    if (message.startsWith('/login ')) {
      const password = message.split(/\s+/)[1];
      if (!accounts.has(client.username)) {
        say(client, 'You are not registered. Please register first.');
        return;
      }
      if (!password) {
        say(client, 'Usage: /login <password>');
        return;
      }
      client.registered = true;
      say(client, 'Welcome back, you are now logged in.');
      process.stdout.write(`[test-server] login ${client.username}\n`);
      return;
    }

    say(client, `Unknown command: ${message.split(/\s+/)[0]}`);
  });

  const kickAfter = parseInt(process.env.TEST_KICK_AFTER || '0', 10);
  if (kickAfter > 0) {
    setTimeout(() => {
      process.stdout.write(`[test-server] paksa disconnect client ${client.id} (join ${joins})\n`);
      client.end('disconnect.test');
    }, kickAfter);
  }
});

server.on('error', (err) => {
  process.stderr.write(`[test-server] error: ${err.message}\n`);
});

module.exports = server;
