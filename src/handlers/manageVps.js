import { Markup } from 'telegraf';

import { logger } from '../logger.js';
import { Droplet } from '../models/Droplet.js';
import { clientFor, getAccount } from '../services/accountService.js';
import { decrypt } from '../services/crypto.js';
import { pack } from '../utils/callbacks.js';
import { escapeMd } from '../utils/format.js';
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

  await sendOrEdit(ctx, `*Droplet di ${escapeMd(account.label)}*`, Markup.inlineKeyboard(rows));
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
  const lines = [
    `*${escapeMd(droplet.name)}*`,
    '',
    `Status: \`${escapeMd(droplet.status)}\``,
    `IP: \`${escapeMd(ipv4 ?? '—')}\``,
    `Region: \`${escapeMd(droplet.region?.slug ?? '—')}\``,
    `Size: \`${escapeMd(droplet.size_slug ?? '—')}\``,
    `Image: \`${escapeMd(droplet.image?.slug ?? '—')}\``,
    `Created: \`${escapeMd(new Date(droplet.created_at).toISOString().slice(0, 19))}\``,
  ];
  if (stored?.expiresAt) {
    lines.push(`Expires: \`${escapeMd(new Date(stored.expiresAt).toISOString().slice(0, 19))}\``);
  }
  if (stored?.rootPasswordEnc) {
    lines.push('🔐 Root password tersimpan (gunakan tombol *Show password*).');
  }

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('🔁 Reboot', pack('vps', 'a', 'reboot', String(droplet.id))),
      Markup.button.callback('⏻ Power off', pack('vps', 'a', 'off', String(droplet.id))),
      Markup.button.callback('⚡️ Power on', pack('vps', 'a', 'on', String(droplet.id))),
    ],
    [
      Markup.button.callback(
        '🔄 Refresh',
        pack('vps', 'show', String(account._id), String(droplet.id)),
      ),
      ...(stored?.rootPasswordEnc
        ? [Markup.button.callback('🔐 Show password', pack('vps', 'pwd', String(droplet.id)))]
        : []),
    ],
    [Markup.button.callback('💣 Destroy', pack('vps', 'a', 'destroy', String(droplet.id)))],
    [Markup.button.callback('⬅️ Back', pack('vps', 'list', String(account._id)))],
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
}
