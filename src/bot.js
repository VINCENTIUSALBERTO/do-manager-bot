import { Telegraf } from 'telegraf';

import { config } from './config.js';
import { setupAddAccount } from './handlers/addAccount.js';
import { setupCreateVps } from './handlers/createVps.js';
import { setupDashboard } from './handlers/dashboard.js';
import { setupManageVps } from './handlers/manageVps.js';
import { setupStart } from './handlers/start.js';
import { logger } from './logger.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { mongoSession } from './services/session.js';

export function createBot() {
  const bot = new Telegraf(config.BOT_TOKEN, {
    handlerTimeout: 5 * 60 * 1000,
  });

  bot.catch(errorHandler);

  bot.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    logger.debug(
      {
        ms: Date.now() - start,
        type: ctx.updateType,
        from: ctx.from?.id,
      },
      'update handled',
    );
  });

  bot.use(mongoSession());
  bot.use(authMiddleware());

  setupStart(bot);
  setupDashboard(bot);
  setupCreateVps(bot);
  setupManageVps(bot);
  setupAddAccount(bot); // text handler — must be registered last so it runs after others

  return bot;
}
