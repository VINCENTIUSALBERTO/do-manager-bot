import { Session } from '../models/Session.js';

/**
 * Mongo-backed session middleware compatible with Telegraf's classic session
 * API. State is keyed by `<chat_id>:<from_id>` so private DMs and group usage
 * stay isolated.
 */
export function mongoSession() {
  return async (ctx, next) => {
    const chatId = ctx.chat?.id;
    const fromId = ctx.from?.id;
    if (!chatId || !fromId) {
      return next();
    }
    const key = `${chatId}:${fromId}`;

    const doc = await Session.findOne({ key }).lean().exec();
    ctx.session = doc?.data ?? {};

    await next();

    if (ctx.session && Object.keys(ctx.session).length > 0) {
      await Session.updateOne({ key }, { $set: { data: ctx.session } }, { upsert: true }).exec();
    } else {
      await Session.deleteOne({ key }).exec();
    }
  };
}
