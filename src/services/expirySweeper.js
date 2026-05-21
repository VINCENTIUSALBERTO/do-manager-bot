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

  // 1. Warning shot 1 hour before expiry
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
        `⏰ VPS *${d.name}* akan dinonaktifkan (power off) pada ${new Date(d.expiresAt).toISOString().slice(0, 19)} UTC (≤ 1 jam lagi).`,
        { parse_mode: 'Markdown' },
      )
      .catch((err) =>
        logger.warn({ err: err.message, dropletId: d.dropletId }, 'notify expiring failed'),
      );
    await Droplet.updateOne({ _id: d._id }, { $set: { notifiedExpiringSoon: true } }).exec();
  }

  // 2. Power off droplets that just expired (expiresAt <= now) and haven't been notified/powered off yet
  const expired = await Droplet.find({
    autoDestroy: true,
    destroyedAt: { $exists: false },
    expiresAt: { $lte: now },
    notifiedExpired: false,
  }).lean();

  for (const d of expired) {
    const account = await Account.findOne({ _id: d.accountId }).lean();
    if (!account) continue;
    try {
      const client = clientFor(account);
      // Try to power off
      await client.dropletAction(d.dropletId, { type: 'power_off' }).catch((err) => {
        logger.warn(
          { err: err.message, dropletId: d.dropletId },
          'failed to power off on expiry (might be already off)',
        );
      });

      await Droplet.updateOne({ _id: d._id }, { $set: { notifiedExpired: true } }).exec();

      await bot.telegram
        .sendMessage(
          d.telegramId,
          `🔌 VPS *${d.name}* telah expired dan dinonaktifkan (power off). Silakan perpanjang masa aktif dalam waktu 7 hari, jika tidak VPS akan dihapus otomatis.`,
          { parse_mode: 'Markdown' },
        )
        .catch(() => {});
    } catch (err) {
      logger.warn({ err: err.message, dropletId: d.dropletId }, 'auto-poweroff failed');
    }
  }

  // 3. Destroy droplets that have been expired for 7 days (expiresAt <= now - 7 days)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dueForDestruction = await Droplet.find({
    autoDestroy: true,
    destroyedAt: { $exists: false },
    expiresAt: { $lte: sevenDaysAgo },
  }).lean();

  for (const d of dueForDestruction) {
    const account = await Account.findOne({ _id: d.accountId }).lean();
    if (!account) continue;
    try {
      const client = clientFor(account);
      await client.deleteDroplet(d.dropletId);
      await Droplet.updateOne({ _id: d._id }, { $set: { destroyedAt: new Date() } }).exec();

      await bot.telegram
        .sendMessage(
          d.telegramId,
          `💣 VPS *${d.name}* dihapus otomatis karena tidak diperpanjang setelah 7 hari masa tenggang.`,
          { parse_mode: 'Markdown' },
        )
        .catch(() => {});
    } catch (err) {
      logger.warn({ err: err.message, dropletId: d.dropletId }, 'grace-period auto-destroy failed');
    }
  }
}
