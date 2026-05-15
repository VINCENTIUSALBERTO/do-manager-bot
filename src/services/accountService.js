import { Account } from '../models/Account.js';

import { encrypt, decrypt } from './crypto.js';
import { DigitalOceanClient, verifyToken } from './digitalocean.js';

/**
 * Persists a new DO API token for a Telegram user after verifying it works.
 * Returns the saved Account document (plain object).
 */
export async function addAccount({ telegramId, label, token }) {
  const acct = await verifyToken(token);
  if (!acct) {
    throw new Error('DigitalOcean rejected the token. Please double check and try again.');
  }

  const apiTokenEnc = encrypt(token);
  const finalLabel = label || acct.email || `Account ${Date.now()}`;
  const created = await Account.findOneAndUpdate(
    { telegramId, label: finalLabel },
    {
      $set: {
        telegramId,
        label: finalLabel,
        apiTokenEnc,
        doUuid: acct.uuid,
        doEmail: acct.email,
        dropletLimit: acct.droplet_limit ?? 0,
        lastSyncedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return created;
}

export async function listAccounts(telegramId) {
  return Account.find({ telegramId }).sort({ createdAt: 1 }).lean();
}

export async function getAccount(telegramId, accountId) {
  return Account.findOne({ _id: accountId, telegramId }).lean();
}

export async function deleteAccount(telegramId, accountId) {
  return Account.deleteOne({ _id: accountId, telegramId }).exec();
}

/**
 * Returns a configured DO client for a stored account. The token is decrypted
 * just-in-time and never logged.
 */
export function clientFor(account) {
  const token = decrypt(account.apiTokenEnc);
  return new DigitalOceanClient(token);
}

/**
 * Refreshes cached usage stats so the dashboard renders fast.
 */
export async function refreshAccountStats(account) {
  const client = clientFor(account);
  const [acct, balance, droplets] = await Promise.all([
    client.account().catch(() => null),
    client.balance().catch(() => null),
    client.listDroplets({ perPage: 1 }).catch(() => null),
  ]);

  const update = {
    lastSyncedAt: new Date(),
  };
  if (acct?.account) {
    update.doEmail = acct.account.email;
    update.dropletLimit = acct.account.droplet_limit ?? 0;
  }
  if (balance) {
    update.balance = balance.account_balance;
    update.monthUsage = balance.month_to_date_usage;
  }
  if (droplets) {
    update.dropletCount = droplets.meta?.total ?? 0;
  }
  await Account.updateOne({ _id: account._id }, { $set: update }).exec();
  return { ...account, ...update };
}
