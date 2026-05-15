import { Markup } from 'telegraf';

import { logger } from '../logger.js';
import { getAccount, listAccounts, refreshAccountStats } from '../services/accountService.js';
import { pack } from '../utils/callbacks.js';
import { escapeMd, formatMoney } from '../utils/format.js';

function buildDashboardText(account) {
  const lines = [
    `*${escapeMd(account.label)}*`,
    '',
    `👤 *Name:* ${escapeMd(account.label)}`,
    `📧 *Email:* ${escapeMd(account.doEmail ?? '—')}`,
    `💰 *Balance:* ${escapeMd(formatMoney(account.balance ?? 0))}`,
    `📊 *MTD usage:* ${escapeMd(formatMoney(account.monthUsage ?? 0))}`,
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
