import { Markup } from 'telegraf';

import { logger } from '../logger.js';
import { Droplet } from '../models/Droplet.js';
import {
  getAccount,
  listAccounts,
  refreshAccountStats,
  deleteAccount,
} from '../services/accountService.js';
import { pack } from '../utils/callbacks.js';
import { escapeMd } from '../utils/format.js';

function buildDashboardText(account) {
  const lines = [
    `*Account Information*`,
    '',
    `📧 *Email:* ${escapeMd(account.doEmail ?? '—')}`,
    `🖥 *Droplets:* ${escapeMd(`${account.dropletCount ?? 0}/${account.dropletLimit ?? 0}`)}`,
  ];
  if (account.lastSyncedAt) {
    const ts = new Date(account.lastSyncedAt).toISOString().replace('T', ' ').slice(0, 19);
    lines.push('', `_synced ${escapeMd(ts)} UTC_`);
  }
  return lines.join('\n');
}

function dashboardKeyboard(account) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🚀 Create VPS', pack('vps', 'create', String(account._id))),
      Markup.button.callback('🛠 Manage VPS', pack('vps', 'list', String(account._id))),
    ],
    [
      Markup.button.callback('🔄 Refresh', pack('acct', 'refresh', String(account._id))),
      Markup.button.callback('🔁 Switch / Add', pack('acct', 'switch')),
    ],
    [
      Markup.button.callback('📖 Bantuan', pack('help', 'show')),
      Markup.button.callback('🗑 Hapus Akun', pack('acct', 'del', String(account._id))),
    ],
  ]);
}

export async function renderDashboard(ctx, account, { edit = false } = {}) {
  const text = buildDashboardText(account);
  const kb = dashboardKeyboard(account);
  const opts = {
    parse_mode: 'MarkdownV2',
    ...kb,
    link_preview_options: { is_disabled: true },
  };

  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch (err) {
      // Telegram throws 400 when the new text is identical — fall back to reply.
      logger.debug({ err: err.description }, 'edit failed, sending new message');
    }
  }
  await ctx.reply(text, opts);
}

export async function renderAccountList(ctx, accounts) {
  const buttons = accounts.map((a) => [
    Markup.button.callback(`👤 ${a.label}`, pack('acct', 'open', String(a._id))),
  ]);
  buttons.push([Markup.button.callback('➕ Add Account', pack('acct', 'add'))]);
  await ctx.reply(
    'Pilih akun DigitalOcean yang ingin kamu kelola:',
    Markup.inlineKeyboard(buttons),
  );
}

export function setupDashboard(bot) {
  bot.action(/^acct:open:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const account = await getAccount(ctx.from.id, id);
    if (!account) {
      await ctx.answerCbQuery('Account not found.');
      return;
    }
    ctx.session.activeAccountId = String(account._id);
    await ctx.answerCbQuery();
    const synced = await refreshAccountStats(account).catch(() => account);
    await renderDashboard(ctx, synced, { edit: true });
  });

  bot.action(/^acct:refresh:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const account = await getAccount(ctx.from.id, id);
    if (!account) {
      await ctx.answerCbQuery('Account not found.');
      return;
    }
    await ctx.answerCbQuery('Refreshing…');
    const synced = await refreshAccountStats(account).catch(() => account);
    await renderDashboard(ctx, synced, { edit: true });
  });

  bot.action('acct:switch', async (ctx) => {
    await ctx.answerCbQuery();
    const accounts = await listAccounts(ctx.from.id);
    await renderAccountList(ctx, accounts);
  });

  bot.action('acct:add', async (ctx) => {
    ctx.session.flow = 'awaiting_token';
    ctx.session.tokenLabel = null;
    await ctx.answerCbQuery();
    await ctx.reply(
      'Send me the DigitalOcean Personal Access Token for the new account. Send /cancel to abort.',
    );
  });

  bot.action(/^acct:del:(.+)$/, async (ctx) => {
    const accountId = ctx.match[1];
    const account = await getAccount(ctx.from.id, accountId);
    if (!account) return ctx.answerCbQuery('Account not found.');
    await ctx.answerCbQuery();
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Ya, hapus akun', pack('acct', 'delyes', String(account._id))),
        Markup.button.callback('❌ Batal', pack('acct', 'open', String(account._id))),
      ],
    ]);
    await ctx.reply(
      `Konfirmasi: hapus akun *${escapeMd(account.label)}* dari bot?\n_\\(VPS di DigitalOcean tidak akan terhapus\\)_`,
      {
        parse_mode: 'MarkdownV2',
        ...kb,
      },
    );
  });

  bot.action(/^acct:delyes:(.+)$/, async (ctx) => {
    const accountId = ctx.match[1];
    await deleteAccount(ctx.from.id, accountId);
    await Droplet.deleteMany({ accountId, telegramId: ctx.from.id }).exec();

    if (ctx.session.activeAccountId === accountId) {
      ctx.session.activeAccountId = null;
    }

    await ctx.answerCbQuery('Akun dihapus');
    try {
      ctx.deleteMessage().catch(() => {});
    } catch {
      /* ignore */
    }

    await ctx.reply('🗑 Akun berhasil dihapus dari kelola bot.');
    const accounts = await listAccounts(ctx.from.id);
    if (accounts.length) {
      await renderAccountList(ctx, accounts);
    } else {
      await ctx.reply(
        'Kamu tidak memiliki akun DigitalOcean yang dikelola. Ketik /start untuk menambahkan.',
      );
    }
  });

  bot.command('accounts', async (ctx) => {
    const accounts = await listAccounts(ctx.from.id);
    if (!accounts.length) {
      await ctx.reply('You have no DigitalOcean accounts yet. Send /start to add one.');
      return;
    }
    await renderAccountList(ctx, accounts);
  });

  bot.action('noop', (ctx) => ctx.answerCbQuery().catch(() => {}));
}
