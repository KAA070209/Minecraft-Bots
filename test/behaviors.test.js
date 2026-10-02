'use strict';

const mineflayer = require('mineflayer');

const PORT = process.env.TEST_PORT || '25566';
const VERSION = process.env.TEST_VERSION || '1.16';

const config = {
  server: { host: '127.0.0.1', port: Number(PORT) },
  account: { username: 'TestBot' },
  afk: {
    mode: 'safe',
    minIntervalMs: 1500,
    maxIntervalMs: 2000,
    yawStepDeg: 70,
    pitchMinDeg: -25,
    pitchMaxDeg: 15,
    swingArm: true,
    jumpChance: 1
  },
  survival: { autoEat: true, eatBelowFood: 18, eatBelowHealth: 17, rescue: true, lowHealthQuit: 0 }
};

const logs = [];
const logger = {
  info: (m) => { logs.push(`INFO ${m}`); process.stdout.write(`  ${m}\n`); },
  success: (m) => { logs.push(`OK   ${m}`); process.stdout.write(`  ${m}\n`); },
  warn: (m) => { logs.push(`WARN ${m}`); process.stdout.write(`  ${m}\n`); },
  error: (m) => { logs.push(`ERR  ${m}`); process.stderr.write(`  ${m}\n`); },
  debug: () => {}
};

const { attachBehaviors, getHealth, findSafeSpot } = require('../lib/behaviors');
const { Vec3 } = require('vec3');

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
}

const bot = mineflayer.createBot({
  host: config.server.host,
  port: config.server.port,
  username: config.account.username,
  version: config.afk.version || VERSION
});

let behavior = null;
const errors = [];

bot.on('error', (err) => {
  errors.push(err);
  process.stderr.write(`  [bot error] ${err.message}\n`);
});

bot.on('login', () => process.stdout.write(`  [event login] protocol=${bot.protocolVersion}\n`));
bot.on('end', (r) => process.stdout.write(`  [event end] ${r}\n`));
bot.on('kicked', (r) => process.stdout.write(`  [event kicked] ${JSON.stringify(r)}\n`));
bot._client.on('disconnect', (p) => process.stdout.write(`  [packet disconnect] ${JSON.stringify(p)}\n`));
bot._client.on('compress', () => process.stdout.write('  [packet compress]\n'));
bot._client.on('login', (p) => process.stdout.write('  [packet login] received\n'));
bot._client.on('position', (p) => process.stdout.write(`  [packet position] ${JSON.stringify(p)}\n`));
bot._client.on('keep_alive', () => process.stdout.write('  [packet keep_alive]\n'));
bot._client.on('error', (e) => process.stdout.write(`  [client error] ${e.message}\n`));

bot.once('spawn', () => {
  process.stdout.write('\n[test] spawn received\n');
  check('spawn received', true, `version ${bot.version}`);
  check('entity available', Boolean(bot.entity));
  check('dimension read', typeof bot.game.dimension === 'string', bot.game.dimension);

  const yawBefore = bot.entity.yaw;
  const pitchBefore = bot.entity.pitch;

  behavior = attachBehaviors(bot, config, logger);

  setTimeout(() => {
    const idleBefore = behavior.stats.idleActions;
    behavior.idleAction();
    check('idleAction increments counter', behavior.stats.idleActions === idleBefore + 1);
    check('lookAround changed yaw/pitch', bot.entity.yaw !== yawBefore || bot.entity.pitch !== pitchBefore,
      `yaw ${yawBefore.toFixed(2)} -> ${bot.entity.yaw.toFixed(2)}, pitch ${pitchBefore.toFixed(2)} -> ${bot.entity.pitch.toFixed(2)}`);
    check('swing counted', behavior.stats.swings > 0, `swings=${behavior.stats.swings}`);
    check('jump counted', behavior.stats.jumps > 0, `jumps=${behavior.stats.jumps}`);

    const safe = findSafeSpot(bot, 3);
    check('findSafeSpot returns ground', Boolean(safe), safe ? `${safe.x},${safe.y},${safe.z}` : 'null');
    if (safe) {
      check('safe spot is Vec3 with floored()', typeof safe.floored === 'function');
      check('safe spot is over solid ground', (() => {
        const below = bot.blockAt(new Vec3(Math.floor(safe.x), safe.y - 1, Math.floor(safe.z)));
        return below && below.name !== 'air';
      })());
    }

    behavior.rescueIfNeeded();
    check('rescueIfNeeded does not throw on safe ground', true,
      `pos ${bot.entity.position.x.toFixed(1)},${bot.entity.position.y.toFixed(1)}`);

    behavior.eatIfNeeded().then(() => {
      check('eatIfNeeded handles empty inventory', behavior.stats.eats === 0, 'no food, no crash');
      check('getHealth callable', getHealth(bot) === null || typeof getHealth(bot) === 'number', String(getHealth(bot)));

      setTimeout(() => {
        check('auto idle loop ran', behavior.stats.idleActions >= 2, `idleActions=${behavior.stats.idleActions}`);

        console.log('');
        if (errors.length) {
          check('no runtime errors', false, errors.map((e) => e.message).join(' | '));
        } else {
          check('no runtime errors', true);
        }

        behavior.stop();
        const failed = results.filter((r) => !r.ok);
        console.log(`\n[test] ${results.length - failed.length}/${results.length} passed`);
        bot.quit('test done');
        setTimeout(() => process.exit(failed.length ? 1 : 0), 500);
      }, 4000);
    }).catch((err) => {
      check('eatIfNeeded resolves without throwing', false, err.message);
      behavior.stop();
      bot.quit('test error');
      setTimeout(() => process.exit(1), 500);
    });
  }, 600);
});

setTimeout(() => {
  console.error('\nFAIL  timeout menunggu spawn');
  process.exit(1);
}, 25000);
