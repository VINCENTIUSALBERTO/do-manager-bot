import { logger } from '../logger.js';
import { addAccount, listAccounts, refreshAccountStats } from '../services/accountService.js';

import { renderDashboard, renderAccountList } from './dashboard.js';

const TOKEN_REGEX = /^(dop_v1_)?[a-f0-9]{40,}$/i;

/**
 * Sets up the "awaiting_token" text flow triggered by /start and the
 * "Add account" inline button. The token itself is captured, verified
 * against the DO API, encrypted, and persisted.
 */
export function setupAddAccount(bot) {
  bot.on('text', async (ctx, next) => {
    if (ctx.session?.flow !== 'awaiting_token') return next();
    const token = (ctx.message.text || '').trim();

    // Quietly delete the message containing the token so it doesn't linger
    // in Telegram chat history.
    ctx.deleteMessage(ctx.message.message_id).catch(() => {});

    const user = ctx.state.user;
    const accounts = await listAccounts(ctx.from.id);
    const limit =
      user.accountLimit ?? (user.role === 'admin' ? 9999 : user.role === 'premium' ? 10 : 1);
    if (accounts.length >= limit) {
      ctx.session.flow = null;
      ctx.session.tokenLabel = null;
      await ctx.reply(
        `⚠️ Anda telah mencapai batas maksimal penambahan akun DigitalOcean untuk tipe akun *${user.role.toUpperCase()}* (${accounts.length}/${limit} akun).`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    if (!TOKEN_REGEX.test(token)) {
      await ctx.reply(
        'That does not look like a DigitalOcean personal access token. It usually starts with `dop_v1_` and contains 60+ characters. Please try again or use /cancel.',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const waiting = await ctx.reply('🔎 Verifying token with DigitalOcean…');
    try {
      const account = await addAccount({
        telegramId: ctx.from.id,
        label: ctx.session.tokenLabel,
        token,
      });
      ctx.session.flow = null;
      ctx.session.tokenLabel = null;

      const synced = await refreshAccountStats(account).catch((err) => {
        logger.warn({ err }, 'initial sync failed');
        return account;
      });

      ctx.telegram.deleteMessage(ctx.chat.id, waiting.message_id).catch(() => {});

      const accounts = await listAccounts(ctx.from.id);
      if (accounts.length === 1) {
        ctx.session.activeAccountId = String(synced._id);
        await renderDashboard(ctx, synced);
      } else {
        await renderAccountList(ctx, accounts);
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'add account failed');
      ctx.telegram
        .editMessageText(
          ctx.chat.id,
          waiting.message_id,
          undefined,
          `❌ ${err.message}\n\nSend the token again or /cancel to abort.`,
        )
        .catch(() => {});
    }
  });
}
