'use strict';

const MAX_EMBED = 4000;
const MORE_NOTE = '*…ada yang dipotong, pakai filter untuk lebih sedikit*';

function clip(text, max) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function budgetOf(options) {
  return Math.max(200, Math.min(Number(options.maxLength) || 1800, MAX_EMBED - 200));
}

function blocks(result, budget) {
  const entries = result.results || [];
  const parts = [];
  let truncated = false;
  for (const entry of entries) {
    const body = (entry.lines || []).join('\n');
    const title = entry.name && entry.name !== '-' ? `**${entry.name}**` : null;
    const content = title ? `${title}\n\`\`\`\n${body}\n\`\`\`` : `\`\`\`\n${body}\n\`\`\``;
    const used = parts.join('\n\n').length;
    if (parts.length && used + content.length + 2 + MORE_NOTE.length > budget) {
      truncated = true;
      break;
    }
    if (parts.length === 0 && content.length > budget) {
      parts.push(clip(content, budget));
      truncated = true;
      break;
    }
    parts.push(content);
  }
  if (truncated) {
    const note = entries.length > parts.length ? `*…${entries.length - parts.length} blok lagi dipotong*` : MORE_NOTE;
    parts.push(clip(note, Math.max(0, budget - parts.join('\n\n').length - 2)));
  }
  return parts.join('\n\n');
}

function formatResult(result, options = {}) {
  const color = result.ok ? options.color || 0x2ecc71 : options.errorColor || 0xe74c3c;
  const targets = (result.targets || []).join(', ');
  const budget = budgetOf(options);
  const description = blocks(result, budget);
  const embed = {
    title: result.ok ? `!${result.command}` : `!${result.command} gagal`,
    description: result.error && description ? `${result.error}\n\n${description}` : description || result.error || 'tidak ada output',
    color,
    footer: { text: clip(targets ? `mc-afk-bot • ${targets}` : 'mc-afk-bot', 200) }
  };
  return embed;
}

function formatError(message, options = {}) {
  return {
    title: options.title || 'error',
    description: clip(message, budgetOf(options)),
    color: options.errorColor || 0xe74c3c
  };
}

function formatHelp(commands, options = {}) {
  const budget = budgetOf(options);
  const lines = [];
  for (const command of commands) {
    const row = `\`${command.usage}\` ${command.summary}`;
    if (lines.join('\n').length + row.length + 1 + MORE_NOTE.length > budget) break;
    lines.push(row);
  }
  if (lines.length < commands.length) lines.push('*…sisanya panggil !help*');
  return {
    title: 'perintah bot Minecraft',
    description: lines.join('\n'),
    color: options.color || 0x2ecc71,
    footer: { text: 'prefix dari DISCORD_PREFIX • pakai "all" untuk semua bot' }
  };
}

function formatIdResult(message, options = {}) {
  const channelId = String((message && message.channelId) || 'tidak diketahui');
  const guildId = String((message && message.guildId) || 'DM (tanpa server)');
  const userId = String((message && message.author && message.author.id) || 'tidak diketahui');
  const allowed = (options.allowedChannels || []).map(String).filter(Boolean);
  const isAllowed = !allowed.length || allowed.includes(channelId);
  const lines = [
    `channel   : ${channelId}`,
    `server    : ${guildId}`,
    `user      : ${userId}`,
    `diizinkan : ${isAllowed ? 'YA' : 'TIDAK - bot diam di channel ini'}`,
    `daftar    : ${allowed.length ? allowed.join(', ') : '(semua channel)'}`
  ];
  if (!isAllowed) {
    lines.push('', `Salin ID di atas ke DISCORD_ALLOWED_CHANNELS lalu restart bot.`);
  }
  return {
    title: 'id channel ini',
    description: lines.join('\n'),
    color: isAllowed ? options.color || 0x2ecc71 : options.errorColor || 0xe74c3c
  };
}

module.exports = { formatResult, formatError, formatHelp, formatIdResult, clip };