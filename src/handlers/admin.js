import { Markup } from 'telegraf';

import { logger } from '../logger.js';
import { Account } from '../models/Account.js';
import { Droplet } from '../models/Droplet.js';
import { SystemSettings } from '../models/SystemSettings.js';
import { User } from '../models/User.js';
import { escapeMd } from '../utils/format.js';

const USERS_PER_PAGE = 8;

// Middleware to restrict a command or action to admin users only
export async function adminOnly(ctx, next) {
  const user = ctx.state.user;
  if (!user || user.role !== 'admin') {
    await ctx.reply('⚠️ Anda tidak memiliki akses untuk perintah ini.');
    return;
  }
  return next();
}

/**
 * Builds the Admin Dashboard main text and inline keyboard layout.
 */
async function getAdminDashboard() {
  const totalUsers = await User.countDocuments();
  const premiumUsers = await User.countDocuments({ role: 'premium' });
  const adminUsers = await User.countDocuments({ role: 'admin' });
  const totalAccounts = await Account.countDocuments();
  const activeDroplets = await Droplet.countDocuments({ destroyedAt: { $exists: false } });

  const maintSetting = await SystemSettings.findOne({ key: 'maintenance' }).lean();
  const isMaint = maintSetting?.value === true;

  const text = [
    `👑 *ADMIN DASHBOARD PANEL*`,
    `────────────────────────`,
    `📊 *Statistik Bot:*`,
    `• Total Pengguna: \`${totalUsers}\` \\(\`Premium: ${premiumUsers}\` \\| \`Admin: ${adminUsers}\`\\)`,
    `• Total Akun DO Terhubung: \`${totalAccounts}\``,
    `• Total VPS Aktif: \`${activeDroplets}\``,
    `• Mode Maintenance: ${isMaint ? '🟢 *AKTIF*' : '🔴 *NONAKTIF*'}`,
    `────────────────────────`,
    `Silakan pilih salah satu opsi di bawah untuk mengelola sistem\\.`,
  ].join('\n');

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('👤 Kelola User', 'admin:users:0'),
      Markup.button.callback(
        isMaint ? '🔴 Matikan Maint Mode' : '🟢 Hidupkan Maint Mode',
        'admin:maint:toggle',
      ),
    ],
    [
      Markup.button.callback('📢 Kirim Broadcast', 'admin:broadcast:start'),
      Markup.button.callback('🔄 Refresh Stats', 'admin:dashboard'),
    ],
  ]);

  return { text, kb };
}

async function renderUserDetail(ctx, tgId) {
  const targetUser = await User.findOne({ telegramId: tgId }).lean();
  if (!targetUser) {
    await ctx.reply('User tidak ditemukan.');
    return;
  }

  const accountsCount = await Account.countDocuments({ telegramId: tgId });
  const dropletsCount = await Droplet.countDocuments({
    telegramId: tgId,
    destroyedAt: { $exists: false },
  });

  const limit =
    targetUser.accountLimit ??
    (targetUser.role === 'admin' ? 9999 : targetUser.role === 'premium' ? 10 : 1);

  const userText = [
    `👤 *USER DETAIL PROFILE*`,
    `────────────────────────`,
    `• *Nama:* ${escapeMd(targetUser.firstName ?? '—')}`,
    `• *Username:* ${targetUser.username ? `@${escapeMd(targetUser.username)}` : '—'}`,
    `• *Telegram ID:* \`${targetUser.telegramId}\``,
    `• *Role / Title:* *${targetUser.role.toUpperCase()}*`,
    `• *Batas Akun DO:* \`${limit}\` ${targetUser.accountLimit !== undefined ? '\\(Custom\\)' : '\\(Default Role\\)'}`,
    `• *Akun DO Terhubung:* \`${accountsCount}\``,
    `• *VPS Aktif:* \`${dropletsCount}\``,
    `• *Status:* ${targetUser.isBanned ? '🚫 *DIBANNED*' : '🟢 *AKTIF*'}`,
    `────────────────────────`,
  ].join('\n');

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('💎 Ubah Role', `admin:user:role:${tgId}`),
      Markup.button.callback('🔢 Ubah Limit Akun', `admin:user:limit:${tgId}`),
    ],
    [
      Markup.button.callback(
        targetUser.isBanned ? '🟢 Lepas Ban User' : '🚫 Ban User',
        `admin:user:ban:${tgId}`,
      ),
    ],
    [Markup.button.callback('⬅️ Kembali ke Daftar', 'admin:users:0')],
  ]);

  try {
    await ctx.editMessageText(userText, { parse_mode: 'MarkdownV2', ...kb });
  } catch {
    await ctx.replyWithMarkdownV2(userText, kb);
  }
}

export function setupAdmin(bot) {
  // Command handler /admin
  bot.command('admin', adminOnly, async (ctx) => {
    const { text, kb } = await getAdminDashboard();
    await ctx.replyWithMarkdownV2(text, kb);
  });

  // Command handler /premium <id/username>
  bot.command('premium', adminOnly, async (ctx) => {
    const args = ctx.payload?.trim();
    if (!args) {
      await ctx.reply('⚠️ Format salah. Gunakan: `/premium <telegramId_atau_username>`', {
        parse_mode: 'Markdown',
      });
      return;
    }

    let targetUser;
    if (/^\d+$/.test(args)) {
      targetUser = await User.findOne({ telegramId: Number(args) });
    } else {
      const username = args.replace(/^@/, '');
      targetUser = await User.findOne({ username: new RegExp(`^${username}$`, 'i') });
    }

    if (!targetUser) {
      await ctx.reply(`⚠️ User dengan ID atau username *${args}* tidak ditemukan.`, {
        parse_mode: 'Markdown',
      });
      return;
    }

    await User.updateOne(
      { telegramId: targetUser.telegramId },
      { $set: { role: 'premium' } },
    ).exec();
    await ctx.reply(
      `✅ Berhasil mengubah role *${targetUser.firstName || targetUser.username}* menjadi *PREMIUM*.`,
      { parse_mode: 'Markdown' },
    );
  });

  // Command handler /standard <id/username>
  bot.command('standard', adminOnly, async (ctx) => {
    const args = ctx.payload?.trim();
    if (!args) {
      await ctx.reply('⚠️ Format salah. Gunakan: `/standard <telegramId_atau_username>`', {
        parse_mode: 'Markdown',
      });
      return;
    }

    let targetUser;
    if (/^\d+$/.test(args)) {
      targetUser = await User.findOne({ telegramId: Number(args) });
    } else {
      const username = args.replace(/^@/, '');
      targetUser = await User.findOne({ username: new RegExp(`^${username}$`, 'i') });
    }

    if (!targetUser) {
      await ctx.reply(`⚠️ User dengan ID atau username *${args}* tidak ditemukan.`, {
        parse_mode: 'Markdown',
      });
      return;
    }

    await User.updateOne(
      { telegramId: targetUser.telegramId },
      { $set: { role: 'standard' } },
    ).exec();
    await ctx.reply(
      `✅ Berhasil mengubah role *${targetUser.firstName || targetUser.username}* menjadi *STANDARD*.`,
      { parse_mode: 'Markdown' },
    );
  });

  // Action: Open Dashboard
  bot.action('admin:dashboard', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    const { text, kb } = await getAdminDashboard();
    try {
      await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', ...kb });
    } catch {
      await ctx.replyWithMarkdownV2(text, kb);
    }
  });

  // Action: Close Menu
  bot.action('admin:close', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.deleteMessage();
    } catch {
      // ignore
    }
  });

  // Action: Maintenance Mode Toggle
  bot.action('admin:maint:toggle', adminOnly, async (ctx) => {
    const maintSetting = await SystemSettings.findOne({ key: 'maintenance' });
    const newVal = maintSetting ? !maintSetting.value : true;

    await SystemSettings.updateOne(
      { key: 'maintenance' },
      { $set: { value: newVal } },
      { upsert: true },
    ).exec();

    await ctx.answerCbQuery(
      `Mode Maintenance berhasil ${newVal ? 'diaktifkan' : 'dinonaktifkan'}`,
      { show_alert: true },
    );

    const { text, kb } = await getAdminDashboard();
    try {
      await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', ...kb });
    } catch {
      // ignore
    }
  });

  // Action: List Users with Pagination
  bot.action(/^admin:users:(\d+)$/, adminOnly, async (ctx) => {
    const page = Number(ctx.match[1]);
    await ctx.answerCbQuery();

    const allUsers = await User.find().sort({ createdAt: -1 }).lean();
    const totalPages = Math.ceil(allUsers.length / USERS_PER_PAGE);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));

    const start = safePage * USERS_PER_PAGE;
    const slice = allUsers.slice(start, start + USERS_PER_PAGE);

    const buttons = [];
    for (const u of slice) {
      const accountsCount = await Account.countDocuments({ telegramId: u.telegramId });
      const name = u.firstName ?? u.username ?? `User ${u.telegramId}`;
      const statusIcon = u.isBanned ? '🚫' : '';
      const label = `${name} [${u.role.toUpperCase()}] (${accountsCount} Akun) ${statusIcon}`;
      buttons.push([Markup.button.callback(label, `admin:user:show:${u.telegramId}`)]);
    }

    // Pagination row
    const nav = [];
    if (safePage > 0) {
      nav.push(Markup.button.callback('⬅️ Prev', `admin:users:${safePage - 1}`));
    }
    nav.push(Markup.button.callback(`${safePage + 1} / ${totalPages || 1}`, 'noop'));
    if (safePage < totalPages - 1) {
      nav.push(Markup.button.callback('Next ➡️', `admin:users:${safePage + 1}`));
    }

    const kbRows = [...buttons];
    if (nav.length) kbRows.push(nav);
    kbRows.push([Markup.button.callback('⬅️ Kembali ke Dashboard', 'admin:dashboard')]);

    const text = `👤 *MANAGE USERS*\nTotal terdaftar: *${allUsers.length}* user.\nPilih user di bawah untuk detail & kontrol:`;
    try {
      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(kbRows),
      });
    } catch {
      await ctx.reply(text, Markup.inlineKeyboard(kbRows));
    }
  });

  // Action: Show User Details
  bot.action(/^admin:user:show:(\d+)$/, adminOnly, async (ctx) => {
    const tgId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await renderUserDetail(ctx, tgId);
  });

  // Action: Toggle Ban User
  bot.action(/^admin:user:ban:(\d+)$/, adminOnly, async (ctx) => {
    const tgId = Number(ctx.match[1]);
    const targetUser = await User.findOne({ telegramId: tgId });
    if (!targetUser) {
      await ctx.answerCbQuery('User tidak ditemukan.');
      return;
    }

    if (tgId === ctx.from.id) {
      await ctx.answerCbQuery('Anda tidak bisa membanned akun Anda sendiri!', { show_alert: true });
      return;
    }

    const newVal = !targetUser.isBanned;
    await User.updateOne({ telegramId: tgId }, { $set: { isBanned: newVal } }).exec();

    await ctx.answerCbQuery(`User berhasil ${newVal ? 'di-ban' : 'di-unban'}`);
    await renderUserDetail(ctx, tgId);
  });

  // Action: Change Role Screen
  bot.action(/^admin:user:role:(\d+)$/, adminOnly, async (ctx) => {
    const tgId = Number(ctx.match[1]);
    await ctx.answerCbQuery();

    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback('Standard', `admin:user:setrole:${tgId}:standard`),
        Markup.button.callback('Premium', `admin:user:setrole:${tgId}:premium`),
      ],
      [Markup.button.callback('⬅️ Batal', `admin:user:show:${tgId}`)],
    ]);

    await ctx.editMessageText('Pilih role / level akses baru untuk user ini:', kb);
  });

  // Action: Set Role
  bot.action(/^admin:user:setrole:(\d+):(\w+)$/, adminOnly, async (ctx) => {
    const tgId = Number(ctx.match[1]);
    const newRole = ctx.match[2];

    if (newRole !== 'standard' && newRole !== 'premium') {
      await ctx.answerCbQuery('Role tidak diizinkan!', { show_alert: true });
      return;
    }

    const targetUser = await User.findOne({ telegramId: tgId });
    if (!targetUser) {
      await ctx.answerCbQuery('User tidak ditemukan.');
      return;
    }

    await User.updateOne({ telegramId: tgId }, { $set: { role: newRole } }).exec();
    await ctx.answerCbQuery(`Role berhasil diubah menjadi ${newRole.toUpperCase()}`);
    await renderUserDetail(ctx, tgId);
  });

  // Action: Ask for custom limit
  bot.action(/^admin:user:limit:(\d+)$/, adminOnly, async (ctx) => {
    const tgId = Number(ctx.match[1]);
    await ctx.answerCbQuery();

    ctx.session.adminFlow = {
      action: 'set_limit',
      targetTgId: tgId,
    };

    await ctx.reply(
      'Ketikkan batas jumlah akun DigitalOcean baru untuk user ini (angka 1-100), atau ketik `default` untuk menghapus custom limit dan menggunakan default role.',
      { parse_mode: 'Markdown' },
    );
  });

  // Action: Broadcast Start
  bot.action('admin:broadcast:start', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminFlow = { action: 'broadcast' };
    await ctx.reply(
      'Kirimkan pesan broadcast yang ingin disebarkan ke semua pengguna. Anda bisa menggunakan format text, emoji, dan Markdown.',
    );
  });

  // Handler for text input in Admin flows
  bot.on('text', async (ctx, next) => {
    const flow = ctx.session?.adminFlow;
    if (!flow) return next();

    const text = (ctx.message.text || '').trim();
    if (text.startsWith('/')) return next();

    if (flow.action === 'set_limit') {
      ctx.session.adminFlow = null;
      const targetTgId = flow.targetTgId;

      if (text.toLowerCase() === 'default') {
        await User.updateOne({ telegramId: targetTgId }, { $unset: { accountLimit: '' } }).exec();
        await ctx.reply('✅ Custom limit berhasil dihapus. Menggunakan limit bawaan role.');
        return;
      }

      const num = Number(text);
      if (!Number.isInteger(num) || num < 1 || num > 100) {
        await ctx.reply(
          '❌ Input tidak valid. Kirimkan angka bulat antara 1 sampai 100, atau ketik `default`.',
        );
        return;
      }

      await User.updateOne({ telegramId: targetTgId }, { $set: { accountLimit: num } }).exec();
      await ctx.reply(`✅ Batas maksimal akun DO berhasil diubah menjadi ${num} akun.`);
      return;
    }

    if (flow.action === 'broadcast') {
      ctx.session.adminFlow = null;
      ctx.session.broadcastMsg = text;

      const totalUsers = await User.countDocuments();
      const kb = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Ya, Kirim Sekarang', 'admin:broadcast:send'),
          Markup.button.callback('❌ Batalkan', 'admin:dashboard'),
        ],
      ]);

      await ctx.reply(
        `📢 *KONFIRMASI BROADCAST*\n\nPesan:\n"${text}"\n\nApakah Anda yakin ingin menyebarkan pesan ini ke *${totalUsers}* user terdaftar?`,
        { parse_mode: 'Markdown', ...kb },
      );
    }
  });

  // Action: Send Broadcast
  bot.action('admin:broadcast:send', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    const text = ctx.session.broadcastMsg;
    if (!text) {
      await ctx.reply('❌ Tidak ada pesan broadcast untuk dikirim.');
      return;
    }

    ctx.session.broadcastMsg = null;

    try {
      await ctx.deleteMessage();
    } catch {
      // ignore
    }

    const users = await User.find().lean();
    const statusMsg = await ctx.reply(`🚀 Memulai pengiriman broadcast ke ${users.length} user...`);

    let success = 0;
    let failed = 0;

    for (const u of users) {
      try {
        await ctx.telegram.sendMessage(u.telegramId, text);
        success++;
      } catch (err) {
        failed++;
        logger.warn({ err: err.message, target: u.telegramId }, 'failed to send broadcast message');
      }
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `📢 *Laporan Broadcast Selesai*\n\n✅ Sukses: ${success} user\n❌ Gagal: ${failed} user`,
      { parse_mode: 'Markdown' },
    );
  });
}
