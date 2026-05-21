import { logger } from '../logger.js';

const userMessageTimes = new Map(); // telegramId -> array of timestamps
const userLastWarned = new Map(); // telegramId -> timestamp of last warning

const LIMIT = 3; // max messages allowed in the window
const WINDOW_MS = 3000; // time window in ms (3 seconds)
const WARNING_COOLDOWN_MS = 5000; // avoid spamming the user back with warnings (5 seconds)

export function antiSpamMiddleware() {
  return async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId) return next();

    const now = Date.now();
    let timestamps = userMessageTimes.get(fromId) || [];
    timestamps = timestamps.filter((t) => now - t < WINDOW_MS);

    if (timestamps.length >= LIMIT) {
      logger.warn({ fromId }, 'anti-spam: rate limit exceeded');

      const lastWarned = userLastWarned.get(fromId) || 0;
      if (now - lastWarned > WARNING_COOLDOWN_MS) {
        userLastWarned.set(fromId, now);
        await ctx
          .reply('⚠️ Harap jangan mengirimkan pesan terlalu cepat (anti-spam).')
          .catch(() => {});
      }
      return; // halt update propagation
    }

    timestamps.push(now);
    userMessageTimes.set(fromId, timestamps);

    return next();
  };
}
