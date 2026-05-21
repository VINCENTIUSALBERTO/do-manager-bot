import { Markup } from 'telegraf';

import { logger } from '../logger.js';
import { Droplet } from '../models/Droplet.js';
import { clientFor, getAccount } from '../services/accountService.js';
import { decrypt } from '../services/crypto.js';
import { pack } from '../utils/callbacks.js';
import {
  escapeMd,
  formatIndoDate,
  getRemainingTimeText,
  formatRegionName,
} from '../utils/format.js';
import { chunk } from '../utils/keyboards.js';

import { renderDashboard } from './dashboard.js';

const PER_PAGE = 8;

function paginate(list, page) {
  const total = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const safe = Math.min(Math.max(page, 0), total - 1);
  return {
    page: safe,
    totalPages: total,
    slice: list.slice(safe * PER_PAGE, safe * PER_PAGE + PER_PAGE),
  };
}

function navRow(prefix, accountId, page, totalPages) {
  if (totalPages <= 1) return [];
  return [
    Markup.button.callback(
      page > 0 ? '« Prev' : '·',
      page > 0 ? pack(prefix, 'page', accountId, page - 1) : 'noop',
    ),
    Markup.button.callback(`${page + 1}/${totalPages}`, 'noop'),
    Markup.button.callback(
      page < totalPages - 1 ? 'Next »' : '·',
      page < totalPages - 1 ? pack(prefix, 'page', accountId, page + 1) : 'noop',
    ),
  ];
}

async function renderList(ctx, account, page = 0) {
  const client = clientFor(account);
  const { droplets } = await client.listDroplets({ page: 1, perPage: 200 });

  if (!droplets.length) {
    await sendOrEdit(
      ctx,
      'Belum ada droplet di akun ini. Pakai *Create VPS* untuk membuat yang pertama.',
      Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Create VPS', pack('vps', 'create', String(account._id)))],
        [Markup.button.callback('⬅️ Dashboard', pack('acct', 'open', String(account._id)))],
      ]),
    );
    return;
  }

  const sorted = [...droplets].sort((a, b) => a.name.localeCompare(b.name));
  const { slice, page: safePage, totalPages } = paginate(sorted, page);
  const rows = chunk(
    slice.map((d) =>
      Markup.button.callback(
        `${d.status === 'active' ? '🟢' : '⚪️'} ${d.name}`,
        pack('vps', 'show', String(account._id), String(d.id)),
      ),
    ),
    1,
  );
  const nav = navRow('vps:listpg', String(account._id), safePage, totalPages);
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback('⬅️ Dashboard', pack('acct', 'open', String(account._id)))]);

  const emailText = account.doEmail ?? account.label;
  const listText = [
    `*Droplet di ${escapeMd(emailText)}*`,
    '',
    `Total: *${droplets.length}* VPS`,
    'Silakan pilih salah satu VPS di bawah untuk melakukan manajemen:',
  ].join('\n');

  await sendOrEdit(ctx, listText, Markup.inlineKeyboard(rows));
}

async function renderDroplet(ctx, account, dropletId) {
  const client = clientFor(account);
  let droplet;
  try {
    const res = await client.getDroplet(dropletId);
    droplet = res.droplet;
  } catch (err) {
    logger.warn({ err: err.message }, 'failed to load droplet');
    await ctx.reply('Droplet tidak ditemukan atau sudah dihapus.');
    return;
  }

  const stored = await Droplet.findOne({ accountId: account._id, dropletId }).lean();
  const ipv4 = droplet.networks?.v4?.find((n) => n.type === 'public')?.ip_address;
  const statusEmoji =
    droplet.status === 'active'
      ? '🟢 Aktif'
      : droplet.status === 'off'
        ? '🔴 Nonaktif (Power Off)'
        : `⚪️ ${droplet.status}`;

  const createdDate = new Date(droplet.created_at);
  const createdStr = formatIndoDate(createdDate);

  const lines = [
    `*Detail VPS:* ${escapeMd(droplet.name)}`,
    `*Status:* ${escapeMd(statusEmoji)}`,
    '',
    `💻 *Sistem & Jaringan*`,
    `• *IP Address:* \`${escapeMd(ipv4 ?? '—')}\``,
    `• *Region:* ${escapeMd(formatRegionName(droplet.region?.slug))}`,
    `• *OS Image:* ${escapeMd(droplet.image?.name ?? droplet.image?.slug ?? '—')}`,
    `• *Spesifikasi:* ${escapeMd(`${droplet.vcpus} vCPU | ${Math.round(droplet.memory / 1024)} GB RAM | ${droplet.disk} GB Disk`)}`,
    '',
    `⏳ *Masa Aktif*`,
    `• *Dibuat:* ${escapeMd(createdStr)}`,
  ];

  if (stored?.expiresAt) {
    const expiresDate = new Date(stored.expiresAt);
    const expiresStr = formatIndoDate(expiresDate);
    const remainingText = getRemainingTimeText(stored.expiresAt);
    lines.push(
      `• *Kedaluwarsa:* ${escapeMd(expiresStr)}`,
      `• *Sisa Waktu:* ${escapeMd(remainingText)}`,
    );
  } else {
    lines.push(
      `• *Kedaluwarsa:* ${escapeMd('Tanpa batas')}`,
      `• *Sisa Waktu:* ${escapeMd('Selamanya')}`,
    );
  }

  if (stored?.rootPasswordEnc) {
    lines.push(
      '',
      '🔐 *Keamanan:* Password root tersimpan (gunakan tombol di bawah untuk melihat).',
    );
  }

  const isPowerOn = droplet.status === 'active';
  const powerButton = isPowerOn
    ? Markup.button.callback('📴 Power off', pack('vps', 'a', 'off', String(droplet.id)))
    : Markup.button.callback('⚡️ Power on', pack('vps', 'a', 'on', String(droplet.id)));

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('🔁 Reboot', pack('vps', 'a', 'reboot', String(droplet.id))),
      powerButton,
    ],
    [
      Markup.button.callback(
        '🔄 Refresh',
        pack('vps', 'show', String(account._id), String(droplet.id)),
      ),
      Markup.button.callback('♻️ Rebuild', pack('vps', 'reb_start', String(droplet.id))),
    ],
    [
      Markup.button.callback(
        '📅 Perpanjang Masa Aktif',
        pack('vps', 'extend_start', String(droplet.id)),
      ),
      ...(stored?.rootPasswordEnc
        ? [Markup.button.callback('🔐 Show Password', pack('vps', 'pwd', String(droplet.id)))]
        : []),
    ],
    [
      Markup.button.callback(
        '💣 Hapus VPS (Destroy)',
        pack('vps', 'a', 'destroy', String(droplet.id)),
      ),
    ],
    [Markup.button.callback('⬅️ Kembali', pack('vps', 'list', String(account._id)))],
  ]);

  await sendOrEdit(ctx, lines.join('\n'), kb);
}

async function sendOrEdit(ctx, text, kb) {
  const opts = { parse_mode: 'MarkdownV2', ...kb, link_preview_options: { is_disabled: true } };
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch (err) {
      logger.debug({ err: err.description }, 'edit failed');
    }
  }
  await ctx.reply(text, opts);
}

async function showRebuildImages(ctx, account, dropletId, page = 0) {
  const flow = ctx.session.rebuild;
  if (!flow.options?.distros) {
    const client = clientFor(account);
    const { images } = await client.distributionImages();
    const filtered = images.map((i) => ({
      slug: i.slug,
      name: i.name,
      distribution: i.distribution,
    }));
    filtered.sort((a, b) => (b.slug ?? '').localeCompare(a.slug ?? ''));
    flow.options = { distros: filtered };
  }

  const all = flow.options.distros;
  const { slice, page: safePage, totalPages } = paginate(all, page);

  const rows = chunk(
    slice.map((img, idx) => {
      const label = `${img.distribution ?? ''} · ${img.name ?? img.slug}`.slice(0, 50);
      return Markup.button.callback(
        label,
        pack('vps', 'reb_do', String(dropletId), String(safePage * PER_PAGE + idx)),
      );
    }),
    1,
  );

  if (totalPages > 1) {
    rows.push([
      Markup.button.callback(
        safePage > 0 ? '« Prev' : '·',
        safePage > 0 ? pack('vps', 'rebpg', String(dropletId), safePage - 1) : 'noop',
      ),
      Markup.button.callback(`${safePage + 1}/${totalPages}`, 'noop'),
      Markup.button.callback(
        safePage < totalPages - 1 ? 'Next »' : '·',
        safePage < totalPages - 1 ? pack('vps', 'rebpg', String(dropletId), safePage + 1) : 'noop',
      ),
    ]);
  }

  rows.push([
    Markup.button.callback('❌ Batal', pack('vps', 'show', String(account._id), String(dropletId))),
  ]);

  const text = `*♻️ Rebuild VPS*\n\nOS saat ini: \`${escapeMd(flow.currentOs)}\`\n\nPilih OS baru untuk di\\-install ulang \\(semua data lama akan terhapus\\!\\):`;
  await sendOrEdit(ctx, text, Markup.inlineKeyboard(rows));
}

export function setupManageVps(bot) {
  bot.action(/^vps:list:(.+)$/, async (ctx) => {
    const account = await getAccount(ctx.from.id, ctx.match[1]);
    if (!account) return ctx.answerCbQuery('Account not found');
    ctx.session.activeAccountId = String(account._id);
    await ctx.answerCbQuery();
    await renderList(ctx, account, 0);
  });

  bot.action(/^vps:listpg:page:([^:]+):(\d+)$/, async (ctx) => {
    const account = await getAccount(ctx.from.id, ctx.match[1]);
    if (!account) return;
    await ctx.answerCbQuery();
    await renderList(ctx, account, Number(ctx.match[2]));
  });

  bot.action(/^vps:show:([^:]+):(\d+)$/, async (ctx) => {
    const account = await getAccount(ctx.from.id, ctx.match[1]);
    if (!account) return ctx.answerCbQuery('Account not found');
    await ctx.answerCbQuery();
    await renderDroplet(ctx, account, Number(ctx.match[2]));
  });

  bot.action(/^vps:pwd:(\d+)$/, async (ctx) => {
    const stored = await Droplet.findOne({
      telegramId: ctx.from.id,
      dropletId: Number(ctx.match[1]),
    }).lean();
    if (!stored?.rootPasswordEnc) {
      return ctx.answerCbQuery('Password tidak tersedia');
    }
    await ctx.answerCbQuery();
    const pwd = decrypt(stored.rootPasswordEnc);
    const sent = await ctx.reply(
      `🔐 root password: \`${escapeMd(pwd)}\`\n_Pesan ini akan dihapus dalam 60 detik._`,
      { parse_mode: 'MarkdownV2' },
    );
    setTimeout(() => {
      ctx.telegram.deleteMessage(ctx.chat.id, sent.message_id).catch(() => {});
    }, 60_000);
  });

  bot.action(/^vps:a:(reboot|off|on|destroy):(\d+)$/, async (ctx) => {
    const action = ctx.match[1];
    const dropletId = Number(ctx.match[2]);
    const accountId = ctx.session.activeAccountId;
    const account = accountId ? await getAccount(ctx.from.id, accountId) : null;
    if (!account) return ctx.answerCbQuery('Account not found');

    if (action === 'destroy') {
      await ctx.answerCbQuery();
      const kb = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Ya, hapus', pack('vps', 'destroy', String(dropletId))),
          Markup.button.callback(
            '❌ Batal',
            pack('vps', 'show', String(account._id), String(dropletId)),
          ),
        ],
      ]);
      await ctx.reply('Konfirmasi: hapus VPS ini? Tindakan ini *tidak bisa dibatalkan*.', {
        parse_mode: 'Markdown',
        ...kb,
      });
      return;
    }

    try {
      const client = clientFor(account);
      const map = { reboot: 'reboot', off: 'power_off', on: 'power_on' };
      await client.dropletAction(dropletId, { type: map[action] });
      await ctx.answerCbQuery(`Action ${action} dikirim`);
    } catch (err) {
      logger.warn({ err: err.message }, 'droplet action failed');
      await ctx.answerCbQuery(`Gagal: ${err.message}`);
    }
  });

  bot.action(/^vps:destroy:(\d+)$/, async (ctx) => {
    const dropletId = Number(ctx.match[1]);
    const accountId = ctx.session.activeAccountId;
    const account = accountId ? await getAccount(ctx.from.id, accountId) : null;
    if (!account) return ctx.answerCbQuery('Account not found');

    try {
      const client = clientFor(account);
      await client.deleteDroplet(dropletId);
      await Droplet.updateOne(
        { accountId: account._id, dropletId },
        { $set: { destroyedAt: new Date() } },
      ).exec();
      await ctx.answerCbQuery('Destroyed');
      await ctx.reply('💣 VPS dihapus.');
      await renderDashboard(ctx, account);
    } catch (err) {
      await ctx.answerCbQuery(`Gagal: ${err.message}`);
    }
  });

  bot.action(/^vps:reb_start:(\d+)$/, async (ctx) => {
    const dropletId = Number(ctx.match[1]);
    const accountId = ctx.session.activeAccountId;
    const account = accountId ? await getAccount(ctx.from.id, accountId) : null;
    if (!account) return ctx.answerCbQuery('Account not found');

    await ctx.answerCbQuery('Memuat daftar OS...');

    try {
      const client = clientFor(account);
      const { droplet } = await client.getDroplet(dropletId);
      ctx.session.rebuild = {
        dropletId,
        currentOs: droplet.image?.name || droplet.image?.slug || 'Unknown',
        options: {},
      };
      await showRebuildImages(ctx, account, dropletId, 0);
    } catch (err) {
      await ctx.answerCbQuery(`Gagal memuat VPS: ${err.message}`);
    }
  });

  bot.action(/^vps:rebpg:(\d+):(\d+)$/, async (ctx) => {
    const dropletId = Number(ctx.match[1]);
    const page = Number(ctx.match[2]);
    const accountId = ctx.session.activeAccountId;
    const account = accountId ? await getAccount(ctx.from.id, accountId) : null;
    if (!account) return;
    if (!ctx.session.rebuild) return ctx.answerCbQuery('Session expired');
    await ctx.answerCbQuery();
    await showRebuildImages(ctx, account, dropletId, page);
  });

  bot.action(/^vps:reb_do:(\d+):(\d+)$/, async (ctx) => {
    const dropletId = Number(ctx.match[1]);
    const index = Number(ctx.match[2]);
    const accountId = ctx.session.activeAccountId;
    const account = accountId ? await getAccount(ctx.from.id, accountId) : null;
    if (!account) return ctx.answerCbQuery('Account not found');
    if (!ctx.session.rebuild || !ctx.session.rebuild.options?.distros) {
      return ctx.answerCbQuery('Session expired');
    }

    const image = ctx.session.rebuild.options.distros[index];
    if (!image) return ctx.answerCbQuery('Image not found');

    await ctx.answerCbQuery('Memulai rebuild...');
    try {
      const client = clientFor(account);
      await client.dropletAction(dropletId, { type: 'rebuild', image: image.slug });
      await ctx.reply(
        `♻️ VPS sedang di\\-rebuild dengan OS *${escapeMd(image.name)}*\\.\nProses ini memakan waktu 1\\-2 menit\\.`,
        { parse_mode: 'MarkdownV2' },
      );
      ctx.session.rebuild = null;
      await renderDroplet(ctx, account, dropletId);
    } catch (err) {
      await ctx.reply(`❌ Gagal rebuild: ${err.message}`);
    }
  });

  bot.action(/^vps:extend_start:(\d+)$/, async (ctx) => {
    const dropletId = Number(ctx.match[1]);
    const accountId = ctx.session.activeAccountId;
    const account = accountId ? await getAccount(ctx.from.id, accountId) : null;
    if (!account) return ctx.answerCbQuery('Account not found');

    ctx.session.extendVps = { dropletId, accountId: String(account._id) };
    await ctx.answerCbQuery();
    await ctx.reply(
      'Berapa hari ingin memperpanjang masa aktif VPS ini? Ketik angka hari (misal: 30), atau kirim `0` untuk *tanpa batas*.',
      { parse_mode: 'Markdown' },
    );
  });

  bot.on('text', async (ctx, next) => {
    const flow = ctx.session?.extendVps;
    if (!flow) return next();
    const text = (ctx.message.text || '').trim();
    if (text.startsWith('/')) return next();

    const n = Number(text);
    if (!Number.isFinite(n) || n < 0 || n > 365) {
      await ctx.reply('Masukkan angka antara 0 dan 365.');
      return;
    }

    const dropletId = flow.dropletId;
    const account = await getAccount(ctx.from.id, flow.accountId);
    if (!account) {
      ctx.session.extendVps = null;
      await ctx.reply('Akun tidak ditemukan.');
      return;
    }

    const stored = await Droplet.findOne({ accountId: account._id, dropletId });
    if (!stored) {
      ctx.session.extendVps = null;
      await ctx.reply('VPS tidak ditemukan di database bot.');
      return;
    }

    let newExpiresAt = null;
    if (n > 0) {
      const currentExpiry = stored.expiresAt ? new Date(stored.expiresAt) : new Date();
      const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
      newExpiresAt = new Date(baseDate.getTime() + n * 86_400_000);
    }

    await Droplet.updateOne(
      { _id: stored._id },
      {
        $set: {
          expiresAt: newExpiresAt,
          autoDestroy: n > 0,
          notifiedExpiringSoon: false,
          notifiedExpired: false,
        },
      },
    ).exec();

    ctx.session.extendVps = null;

    let powerOnSuccess = false;
    try {
      const client = clientFor(account);
      await client.dropletAction(dropletId, { type: 'power_on' });
      powerOnSuccess = true;
    } catch (err) {
      logger.warn({ err: err.message, dropletId }, 'failed to power on droplet after extension');
    }

    const expiryText = newExpiresAt
      ? `diperpanjang hingga ${newExpiresAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`
      : 'diubah menjadi tanpa batas aktif';

    let successMsg = `✅ VPS *${escapeMd(stored.name)}* berhasil ${escapeMd(expiryText)}\\.`;
    if (powerOnSuccess) {
      successMsg += `\n⚡️ VPS juga telah otomatis dinyalakan kembali\\.`;
    }

    await ctx.reply(successMsg, { parse_mode: 'MarkdownV2' });

    // Show the droplet menu again
    await renderDroplet(ctx, account, dropletId);
  });
}
