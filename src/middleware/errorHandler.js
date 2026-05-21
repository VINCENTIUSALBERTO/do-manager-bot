import { logger } from '../logger.js';

export function errorHandler(err, ctx) {
  const update = ctx?.update;
  logger.error({ err, update }, 'unhandled error in telegraf handler');
  try {
    if (ctx?.callbackQuery) {
      ctx.answerCbQuery('Something went wrong, please try again.').catch(() => {});
    } else if (ctx?.reply) {
      ctx
        .reply('⚠️ Something went wrong. Please try again or use /start to reset.')
        .catch(() => {});
    }
  } catch (replyErr) {
    logger.error({ replyErr }, 'failed to send error reply');
  }
}
