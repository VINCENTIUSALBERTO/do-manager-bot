import cron from 'node-cron';

import { logger } from '../logger.js';
import { Account } from '../models/Account.js';
import { Droplet } from '../models/Droplet.js';

import { clientFor } from './accountService.js';

/**
 * Periodically destroys droplets whose `expiresAt` has passed and notifies the
 * owner. Also sends a 1-hour warning shot. Runs in-process; for HA you'd put
 * this behind a leader election.
 */
export function startExpirySweeper(bot, schedule) {
  const task = cron.schedule(schedule, () => {
    sweep(bot).catch((err) => logger.error({ err }, 'expiry sweep failed'));
  });
  logger.info({ schedule }, 'expiry sweeper started');
  return task;
}

async function sweep(bot) {
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);

  const upcoming = await Droplet.find({
    autoDestroy: true,
    destroyedAt: { $exists: false },
    notifiedExpiringSoon: false,
    expiresAt: { $gt: now, $lte: inOneHour },
  }).lean();

  for (const d of upcoming) {
    await bot.telegram
      .sendMessage(
        d.telegramId,
        `⏰ VPS *${d.name}* akan dihapus pada ${new Date(d.expiresAt).toISOString().slice(0, 19)} UTC (≤ 1 jam lagi).`,
        { parse_mode: 'Markdown' },
      )
      .catch((err) =>
        logger.warn({ err: err.message, dropletId: d.dropletId }, 'notify expiring failed'),
      );
    await Droplet.updateOne({ _id: d._id }, { $set: { notifiedExpiringSoon: true } }).exec();
  }

  const due = await Droplet.find({
    autoDestroy: true,
    destroyedAt: { $exists: false },
    expiresAt: { $lte: now },
  }).lean();

  for (const d of due) {
    const account = await Account.findOne({ _id: d.accountId }).lean();
    if (!account) continue;
    try {
      const client = clientFor(account);
      await client.deleteDroplet(d.dropletId);
      await Droplet.updateOne({ _id: d._id }, { $set: { destroyedAt: new Date() } }).exec();
      await bot.telegram
        .sendMessage(d.telegramId, `💣 VPS *${d.name}* dihapus otomatis karena masa aktif habis.`, {
          parse_mode: 'Markdown',
        })
        .catch(() => {});
    } catch (err) {
      logger.warn({ err: err.message, dropletId: d.dropletId }, 'auto-destroy failed');
    }
  }
}
