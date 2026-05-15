import { config } from '../config.js';
import { logger } from '../logger.js';
import { User } from '../models/User.js';

/**
 * Restricts the bot to a configured allow-list of Telegram user IDs and keeps
 * the User collection in sync with the latest Telegram profile data.
 */
export function authMiddleware() {
  const allow = new Set(config.ALLOWED_USER_IDS);
  return async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;

    if (allow.size > 0 && !allow.has(fromId)) {
      logger.warn({ fromId }, 'rejecting unauthorised user');
      await ctx.reply(
        'Sorry, this bot is restricted. Ask the operator to add your Telegram ID to ALLOWED_USER_IDS.',
      );
      return;
    }

    ctx.state.user = await User.findOneAndUpdate(
      { telegramId: fromId },
      {
        $set: {
          telegramId: fromId,
          username: ctx.from?.username,
          firstName: ctx.from?.first_name,
          languageCode: ctx.from?.language_code,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    return next();
  };
}
