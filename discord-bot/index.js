'use strict';

const { Client, GatewayIntentBits, Partials, Events, ActivityType } = require('discord.js');

const { loadConfig, configErrors, configHints } = require('./config');
const { createApiClient } = require('./api');
const { DISCORD_COMMANDS, parseMessage, isKnownApiCommand } = require('./commands');
const { formatResult, formatError, formatHelp, formatIdResult } = require('./format');

function allowedIn(list, value) {
  return !list.length || list.includes(String(value));
}

function permitted(config, message) {
  if (!allowedIn(config.allowedGuilds, message.guildId)) return 'guild ini tidak diizinkan';
  if (!allowedIn(config.allowedChannels, message.channelId)) return 'channel ini tidak diizinkan';
  if (config.allowedUsers.length && !config.allowedUsers.includes(String(message.author.id))) {
    return 'user ini tidak punya akses ke perintah bot';
  }
  const roles = message.member && message.member.roles ? [...message.member.roles.cache.keys()] : [];
  if (config.allowedRoles.length && !roles.some((role) => config.allowedRoles.includes(String(role)))) {
    return 'role ini tidak punya akses ke perintah bot';
  }
  return null;
}

function style(config) {
  return { color: config.color, errorColor: config.colorError, maxLength: config.maxLength };
}

// ViewChannel + SendMessages + EmbedLinks + ReadMessageHistory
const INVITE_PERMISSIONS = 1024n | 2048n | 16384n | 65536n;

function inviteUrl(clientId, extraPermissions = INVITE_PERMISSIONS) {
  const perms = (BigInt(extraPermissions) & 0xffffffffn).toString();
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=${perms}`;
}

async function main() {
  const config = loadConfig();
  const errors = configErrors(config);
  if (errors.length) {
    process.stderr.write(`${errors.join('\n')}\n${configHints().join('\n')}\n`);
    process.exit(1);
    return;
  }

  const api = createApiClient({ baseUrl: config.apiUrl, token: config.apiToken, timeoutMs: config.timeoutMs });
  let bots = [];

  async function refreshBots() {
    try {
      const payload = await api.status();
      bots = (payload.bots || []).map((bot) => bot.name).filter(Boolean);
      return bots;
    } catch {
      return bots;
    }
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel],
    allowedMentions: { parse: [] }
  });

  async function reply(message, embed) {
    const payload = { embeds: [embed] };
    try {
      return await message.reply(payload);
    } catch {
      try {
        return await message.author.send(payload);
      } catch {
        return null;
      }
    }
  }

  function log(text) {
    process.stdout.write(`discord: ${text}\n`);
  }

  async function run(message) {
    const parsed = parseMessage(message.content, config.prefix);
    if (!parsed) return;

    if (parsed.command && parsed.command.diagnostic) {
      await reply(message, formatIdResult(message, { ...style(config), allowedChannels: config.allowedChannels }));
      return;
    }

    const denied = permitted(config, message);
    if (denied) {
      log(`ditolak dari channel ${message.channelId} oleh ${message.author.id}: ${denied}`);
      await reply(message, formatError(denied, style(config)));
      return;
    }

    if (!parsed.command) {
      await reply(message, formatError(`perintah tidak dikenal: ${parsed.name}\nketik ${config.prefix}help`, style(config)));
      return;
    }

    const spec = parsed.command;
    const format = style(config);

    if (spec.name === 'help') {
      await reply(message, formatHelp(DISCORD_COMMANDS, format));
      return;
    }

    if (config.requireConfirm && spec.danger && !parsed.args.some((arg) => arg.toLowerCase() === 'confirm')) {
      await reply(
        message,
        formatError(`perintah ini mematikan proses bot.\nUlangi dengan: ${config.prefix}${spec.name} ${parsed.args.join(' ')} confirm`, format)
      );
      return;
    }

    message.channel.sendTyping().catch(() => {});

    try {
      if (spec.api === 'status') {
        await refreshBots();
        const wanted = String(parsed.args[0] || '');
        const known = bots.some((name) => String(name).toLowerCase() === wanted.toLowerCase());
        if (wanted && wanted.toLowerCase() !== 'all' && known) {
          const detail = await api.command(`status ${wanted}`);
          await reply(message, formatResult(detail, format));
          return;
        }
        const payload = await api.status();
        await reply(message, formatResult({ ...payload, command: 'status' }, format));
        return;
      }
      const line = spec.build(parsed.args, { bots });
      if (!line) {
        await reply(message, formatError(`isi argumen: ${spec.usage}`, format));
        return;
      }
      if (!isKnownApiCommand(line.split(/\s+/)[0])) {
        await reply(message, formatError(`perintah "${spec.name}" memetakan ke baris yang tidak dikenal: ${line}`, format));
        return;
      }
      const result = await api.command(line);
      await reply(message, formatResult(result, format));
    } catch (err) {
      const hint =
        err.status === 401
          ? '\nToken MC_API_TOKEN tidak cocok dengan api.token di config.json proses bot.'
          : err.status === 0
            ? '\nPastikan proses bot jalan dengan api.enabled=true dan host/port bisa dijangkau dari sini.'
            : '';
      await reply(message, formatError(`${err.message}${hint}`, format));
    }
  }

  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot) return;
    run(message).catch((err) => {
      process.stderr.write(`discord command gagal: ${err && err.stack ? err.stack : err}\n`);
    });
  });

  client.on(Events.Error, (err) => process.stderr.write(`discord client error: ${err.message}\n`));
  client.on(Events.Warn, (text) => process.stderr.write(`discord client warn: ${text}\n`));

  client.once(Events.ClientReady, (ready) => {
    // Exception di listener akan mematikan proses, jadi bagian logging
    // dibungkus try/catch agar tidak pernah menggagalkan startup.
    try {
      process.stdout.write(`discord login sebagai ${ready.user.tag} (user id ${ready.user.id})\n`);
    } catch {
      /* abaikan */
    }
    try {
      // discord.js >= 14.16: client.guilds adalah GuildManager, cache-nya yang iterable.
      const guilds = [...client.guilds.cache.values()];
      for (const guild of guilds) {
        process.stdout.write(`  server: ${guild.name} (${guild.id})\n`);
      }
      log(`channel diizinkan: ${config.allowedChannels.join(', ') || 'semua channel'}`);
      if (!guilds.length) {
        process.stderr.write(
          [
            'PERINGATAN: bot belum masuk ke server Discord mana pun.',
            `  Undang bot dengan link ini: ${inviteUrl(ready.user.id)}`,
            '  Setelah diundang, jalankan ulang npm start.',
            ''
          ].join('\n')
        );
      } else if (config.allowedChannels.length) {
        const known = new Set();
        for (const guild of guilds) {
          for (const channel of guild.channels.cache.values()) known.add(channel.id);
        }
        const missing = config.allowedChannels.filter((id) => !known.has(id));
        if (missing.length) {
          process.stderr.write(
            `PERINGATAN: channel diizinkan yang tidak ada di server manapun: ${missing.join(', ')}\n` +
            '  Bot hanya bisa membalas di channel yang benar-benar ada. Cek ID-nya dengan !id.\n'
          );
        }
      }
    } catch (err) {
      process.stderr.write(`gagal menulis info guild: ${err && err.message}\n`);
    }
    try {
      // setActivity di discord.js 14.27 sinkron (tidak mengembalikan promise).
      ready.user.setActivity('!help', { type: ActivityType.Watching });
    } catch (err) {
      process.stderr.write(`gagal set activity: ${err && err.message}\n`);
    }
    api
      .health()
      .then(async (health) => {
        const names = await refreshBots();
        process.stdout.write(
          `api bot Minecraft hidup di ${config.apiUrl} (${health.bots} bot: ${names.join(', ') || '-'}) - prefix ${config.prefix}\n`
        );
      })
      .catch((err) => {
        process.stdout.write(`api bot Minecraft belum bisa dihubungi: ${err.message}\n`);
      });
  });

  const refreshTimer = setInterval(refreshBots, 60000);
  refreshTimer.unref?.();

  await client.login(config.discordToken);

  const shutdown = async () => {
    process.stdout.write('\ndiscord bot berhenti\n');
    await client.destroy().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { client, api, config };
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`discord bot gagal start: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}

module.exports = { main, permitted, inviteUrl };