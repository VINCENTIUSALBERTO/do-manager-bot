import { createBot } from './bot.js';
import { config } from './config.js';
import { connectDb, disconnectDb } from './db.js';
import { logger } from './logger.js';
import { startExpirySweeper } from './services/expirySweeper.js';

async function main() {
  await connectDb();

  const bot = createBot();
  const sweeper = startExpirySweeper(bot, config.EXPIRY_CRON);

  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down…');
    try {
      sweeper.stop();
    } catch (err) {
      logger.warn({ err }, 'failed to stop sweeper');
    }
    try {
      bot.stop(signal);
    } catch (err) {
      logger.warn({ err }, 'failed to stop bot');
    }
    await disconnectDb();
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    process.exit(1);
  });

  // bot.launch() resolves only when the bot is stopped, so we don't await it.
  bot.launch({ dropPendingUpdates: true }).catch((err) => {
    logger.fatal({ err }, 'bot crashed');
    process.exit(1);
  });
  logger.info('bot launched');
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
