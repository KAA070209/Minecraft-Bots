'use strict';

const { loadConfig } = require('./lib/config');
const { createLogger } = require('./lib/logger');
const { createRunner } = require('./lib/runner');
const { attachConsole } = require('./lib/console');
const { startControlApi } = require('./lib/api');

function main() {
  const config = loadConfig();

  const logger = createLogger({
    file: config.logging.file,
    color: config.logging.color,
    level: config.logging.level,
    maxLogFileBytes: config.logging.maxLogFileBytes
  });

  const runner = createRunner({ config, logger });
  const state = runner.state;

  logger.info(`AFK bot untuk ${config.server.host}:${config.server.port} (mode ${config.afk.mode})`);
  logger.debug(`config: ${JSON.stringify({ afk: config.afk, survival: config.survival, reconnect: config.reconnect })}`);

  state.rl = attachConsole({ config, logger, state });

  let api = null;
  startControlApi({
    config,
    logger,
    getTargets: () => [
      {
        name: config.account.username,
        status: state.status,
        register: state.registerStatus,
        joins: state.joins,
        runner,
        config
      }
    ]
  }).then((server) => {
    api = server;
  });

  let stopping = false;
  async function shutdown(reason = 'dimatikan manual') {
    if (stopping) return;
    stopping = true;
    if (api) await api.close().catch(() => {});
    await runner.shutdown(reason);
    logger.close();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT (Ctrl+C)'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error(`uncaught exception: ${err && err.stack ? err.stack : err}`);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`unhandled rejection: ${reason && reason.stack ? reason.stack : reason}`);
  });

  runner.connect();

  return { config, logger, runner, shutdown };
}

if (require.main === module) {
  main();
}

module.exports = { main };