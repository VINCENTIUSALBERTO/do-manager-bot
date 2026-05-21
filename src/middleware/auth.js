import { config } from '../config.js';
import { logger } from '../logger.js';
import { SystemSettings } from '../models/SystemSettings.js';
import { User } from '../models/User.js';

/**
 * Syncs the User collection with Telegram profile data, elevates admins,
 * handles banned users, and blocks access for regular users during maintenance mode.
 */
export function authMiddleware() {
  const admins = new Set(config.ADMIN_USER_IDS || []);
  return async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;

    const updates = {
      telegramId: fromId,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      languageCode: ctx.from?.language_code,
    };

    if (admins.has(fromId)) {
      updates.role = 'admin';
    }

    const user = await User.findOneAndUpdate(
      { telegramId: fromId },
      { $set: updates },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    ctx.state.user = user;

    if (user.isBanned) {
      logger.warn({ fromId }, 'rejecting banned user');
      await ctx.reply('⚠️ Akses Anda ke bot ini telah ditangguhkan oleh administrator.');
      return;
    }

    if (user.role !== 'admin') {
      const maintenanceSetting = await SystemSettings.findOne({ key: 'maintenance' }).lean();
      if (maintenanceSetting?.value === true) {
        logger.info({ fromId }, 'rejecting user due to maintenance mode');
        await ctx.reply(
          '⚠️ Bot sedang dalam pemeliharaan (maintenance mode). Silakan coba beberapa saat lagi.',
        );
        return;
      }
    }

    return next();
  };
}
