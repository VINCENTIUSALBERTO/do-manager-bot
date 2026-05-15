import { Markup } from 'telegraf';

import { logger } from '../logger.js';
import { Droplet } from '../models/Droplet.js';
import { clientFor, getAccount } from '../services/accountService.js';
import { encrypt, generateStrongPassword } from '../services/crypto.js';
import { pack } from '../utils/callbacks.js';
import { escapeMd, regionFlag } from '../utils/format.js';
import { chunk } from '../utils/keyboards.js';

import { renderDashboard } from './dashboard.js';

const PER_PAGE = 8;

function ensureFlow(ctx) {
  if (!ctx.session.vps) ctx.session.vps = { step: 'idle', selection: {}, options: {}, page: 0 };
  return ctx.session.vps;
}

function resetFlow(ctx) {
  ctx.session.vps = null;
}

function paginate(list, page) {
  const total = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const safe = Math.min(Math.max(page, 0), total - 1);
  return {
    page: safe,
    totalPages: total,
    slice: list.slice(safe * PER_PAGE, safe * PER_PAGE + PER_PAGE),
  };
}

function navRow(prefix, page, totalPages) {
  if (totalPages <= 1) return [];
  return [
    Markup.button.callback(
      page > 0 ? '« Prev' : '·',
      page > 0 ? pack(prefix, 'page', page - 1) : 'noop',
    ),
    Markup.button.callback(`${page + 1}/${totalPages}`, 'noop'),
    Markup.button.callback(
      page < totalPages - 1 ? 'Next »' : '·',
      page < totalPages - 1 ? pack(prefix, 'page', page + 1) : 'noop',
    ),
  ];
}

function backRow() {
  return [Markup.button.callback('⬅️ Cancel', pack('vps', 'cancel'))];
}

// ---------------------------------------------------------------- region

async function showRegion(ctx, account, page = 0) {
  const flow = ensureFlow(ctx);
  flow.step = 'region';
  flow.accountId = String(account._id);
  flow.page = page;

  if (!flow.options.regions) {
    const client = clientFor(account);
    const { regions } = await client.regions();
    flow.options.regions = regions
      .filter((r) => r.available && r.sizes.length > 0)
      .map((r) => ({ slug: r.slug, name: r.name }));
  }

  const { slice, page: safePage, totalPages } = paginate(flow.options.regions, page);
  const rows = chunk(
    slice.map((r) =>
      Markup.button.callback(
        `${regionFlag(r.slug)} ${r.name} (${r.slug})`,
        pack('vps', 'rgn', r.slug),
      ),
    ),
    1,
  );
  rows.push(navRow('vps:rgnpage', safePage, totalPages));
  rows.push(backRow());

  const text = '*Step 1/6 · Region*\nPilih region untuk VPS baru:';
  await sendOrEdit(ctx, text, Markup.inlineKeyboard(rows));
}

// ----------------------------------------------------------- image type

async function showImageType(ctx) {
  const flow = ensureFlow(ctx);
  flow.step = 'imageType';
  const text = `*Step 2/6 · Image*\nRegion: \`${escapeMd(flow.selection.region)}\`\n\nPilih sumber image:`;
  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('🐧 OS / Distribution', pack('vps', 'itype', 'distribution')),
      Markup.button.callback('🛒 Marketplace App', pack('vps', 'itype', 'application')),
    ],
    backRow(),
  ]);
  await sendOrEdit(ctx, text, kb);
}

// --------------------------------------------------------------- image

async function showImages(ctx, account, page = 0) {
  const flow = ensureFlow(ctx);
  flow.step = 'image';
  flow.page = page;

  const cacheKey = flow.selection.imageType === 'application' ? 'apps' : 'distros';
  if (!flow.options[cacheKey]) {
    const client = clientFor(account);
    const { images } =
      flow.selection.imageType === 'application'
        ? await client.applicationImages()
        : await client.distributionImages();
    const filtered = images
      .filter((i) => Array.isArray(i.regions) && i.regions.includes(flow.selection.region))
      .map((i) => ({
        slug: i.slug,
        name: i.name,
        distribution: i.distribution,
      }));
    // Sort newest first; "20-04" > "18-04" lexicographically works for our case.
    filtered.sort((a, b) => (b.slug ?? '').localeCompare(a.slug ?? ''));
    flow.options[cacheKey] = filtered;
  }

  const all = flow.options[cacheKey];
  if (all.length === 0) {
    await sendOrEdit(
      ctx,
      'Tidak ada image yang tersedia untuk region tersebut. Coba region lain.',
      Markup.inlineKeyboard([backRow()]),
    );
    return;
  }

  const { slice, page: safePage, totalPages } = paginate(all, page);
  // We have to keep slugs short enough to fit in 64-byte callback_data. Most
  // DO image slugs are <40 chars so this is fine; the few that are longer get
  // proxied through an index lookup.
  const rows = chunk(
    slice.map((img, idx) => {
      const label = `${img.distribution ?? ''} · ${img.name ?? img.slug}`.slice(0, 50);
      const payload = `vps:img:${img.slug}`;
      const data =
        Buffer.byteLength(payload) <= 64
          ? payload
          : pack('vps', 'imgi', String(safePage * PER_PAGE + idx));
      return Markup.button.callback(label, data);
    }),
    1,
  );
  rows.push(navRow('vps:imgpage', safePage, totalPages));
  rows.push(backRow());

  const title = flow.selection.imageType === 'application' ? 'Marketplace App' : 'Distribution';
  await sendOrEdit(
    ctx,
    `*Step 2/6 · ${escapeMd(title)}*\nPilih image:`,
    Markup.inlineKeyboard(rows),
  );
}

// --------------------------------------------------------------- spec type

async function showSpecType(ctx) {
  const flow = ensureFlow(ctx);
  flow.step = 'specType';
  const text = `*Step 3/6 · Spec family*\nImage: \`${escapeMd(flow.selection.image?.slug ?? '—')}\`\n\nPilih tipe spesifikasi:`;
  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('💧 Regular', pack('vps', 'spec', 'regular')),
      Markup.button.callback('🟥 AMD', pack('vps', 'spec', 'amd')),
      Markup.button.callback('🟦 Intel', pack('vps', 'spec', 'intel')),
    ],
    backRow(),
  ]);
  await sendOrEdit(ctx, text, kb);
}

// ----------------------------------------------------------------- size

function matchSpecFamily(size, family) {
  // The DigitalOcean API does not expose a "family" field, so we match on the
  // size slug convention:
  //   s-* / so-* / m-* / c-* / g-* with no suffix → regular
  //   *-amd                                       → AMD
  //   *-intel                                     → Intel
  if (!size?.available) return false;
  if (family === 'amd') return /-amd$/i.test(size.slug);
  if (family === 'intel') return /-intel$/i.test(size.slug);
  return !/-(amd|intel)$/i.test(size.slug);
}

async function showSizes(ctx, account, page = 0) {
  const flow = ensureFlow(ctx);
  flow.step = 'size';
  flow.page = page;

  if (!flow.options.sizes) {
    const client = clientFor(account);
    const { sizes } = await client.sizes();
    flow.options.sizes = sizes
      .filter((s) => s.regions?.includes(flow.selection.region))
      .map((s) => ({
        slug: s.slug,
        memory: s.memory,
        vcpus: s.vcpus,
        disk: s.disk,
        priceMonthly: s.price_monthly,
        priceHourly: s.price_hourly,
        available: s.available,
      }));
  }

  const filtered = flow.options.sizes.filter((s) => matchSpecFamily(s, flow.selection.specType));
  if (filtered.length === 0) {
    await sendOrEdit(
      ctx,
      'Tidak ada size yang cocok untuk kombinasi tersebut. Coba spec family lain.',
      Markup.inlineKeyboard([backRow()]),
    );
    return;
  }

  filtered.sort((a, b) => a.priceMonthly - b.priceMonthly);
  const { slice, page: safePage, totalPages } = paginate(filtered, page);

  const rows = chunk(
    slice.map((s) => {
      const label = `${s.vcpus}vCPU · ${Math.round(s.memory / 1024)}GB · ${s.disk}GB · $${s.priceMonthly}/mo`;
      return Markup.button.callback(label, pack('vps', 'sz', s.slug));
    }),
    1,
  );
  rows.push(navRow('vps:szpage', safePage, totalPages));
  rows.push(backRow());

  await sendOrEdit(
    ctx,
    `*Step 4/6 · Size*\nPilih plan ${escapeMd(flow.selection.specType)}:`,
    Markup.inlineKeyboard(rows),
  );
}

// ----------------------------------------------------------------- security

async function showSecurity(ctx, account, page = 0) {
  const flow = ensureFlow(ctx);
  flow.step = 'security';
  flow.page = page;

  if (!flow.options.sshKeys) {
    const client = clientFor(account);
    const { ssh_keys: keys } = await client.listSshKeys();
    flow.options.sshKeys = keys.map((k) => ({
      id: k.id,
      name: k.name,
      fingerprint: k.fingerprint,
    }));
  }

  flow.selection.security = flow.selection.security ?? { mode: null, sshKeyIds: [] };

  const rows = [
    [
      Markup.button.callback(
        `${flow.selection.security.mode === 'password_random' ? '✅' : '🎲'} Password random`,
        pack('vps', 'sec', 'pwr'),
      ),
    ],
    [
      Markup.button.callback(
        `${flow.selection.security.mode === 'password_custom' ? '✅' : '✏️'} Password custom`,
        pack('vps', 'sec', 'pwc'),
      ),
    ],
  ];

  const { slice, page: safePage, totalPages } = paginate(flow.options.sshKeys, page);
  for (const k of slice) {
    const selected = flow.selection.security.sshKeyIds?.includes(k.id);
    rows.push([
      Markup.button.callback(
        `${selected ? '✅' : '🔑'} ${k.name}`,
        pack('vps', 'sec', 'ssh', String(k.id)),
      ),
    ]);
  }
  if (totalPages > 1) rows.push(navRow('vps:secpage', safePage, totalPages));
  rows.push([Markup.button.callback('➕ Tambah SSH key', pack('vps', 'sec', 'addssh'))]);

  if (flow.selection.security.mode || (flow.selection.security.sshKeyIds?.length ?? 0) > 0) {
    rows.push([Markup.button.callback('➡️ Lanjut', pack('vps', 'sec', 'done'))]);
  }
  rows.push(backRow());

  await sendOrEdit(
    ctx,
    '*Step 5/6 · Keamanan*\nPilih cara akses VPS\\. Bisa kombinasi password \\+ SSH keys:',
    Markup.inlineKeyboard(rows),
  );
}

// ---------------------------------------------------------- hostname / lifetime

async function askHostname(ctx) {
  const flow = ensureFlow(ctx);
  flow.step = 'await_hostname';
  await sendOrEdit(
    ctx,
    '*Step 6/6 · Hostname*\nKetik *nama / hostname* untuk VPS\\.\nKirim `default` untuk auto\\-generate\\.',
    Markup.inlineKeyboard([backRow()]),
  );
}

async function askLifetime(ctx) {
  const flow = ensureFlow(ctx);
  flow.step = 'await_lifetime';
  await ctx.reply(
    'Berapa hari masa aktif VPS (auto-destroy)? Ketik angka, atau kirim `0` untuk *tanpa batas*.',
    { parse_mode: 'Markdown' },
  );
}

// ---------------------------------------------------------- confirmation

function buildConfirmText(flow, sizeInfo) {
  const sec = flow.selection.security ?? {};
  const secLines = [];
  if (sec.mode === 'password_random') {
    secLines.push(`• ${escapeMd('Password random (akan ditampilkan setelah dibuat)')}`);
  }
  if (sec.mode === 'password_custom') {
    secLines.push(`• ${escapeMd('Password custom (sudah disetel)')}`);
  }
  if (sec.sshKeyIds?.length) {
    secLines.push(`• ${escapeMd(`${sec.sshKeyIds.length} SSH key`)}`);
  }

  const lifetimeText =
    flow.selection.lifetimeDays > 0 ? `${flow.selection.lifetimeDays} hari` : 'tanpa batas';

  return [
    '*Konfirmasi VPS*',
    '',
    `${escapeMd('Hostname:')} \`${escapeMd(flow.selection.hostname)}\``,
    `${escapeMd('Region:')} \`${escapeMd(flow.selection.region)}\``,
    `${escapeMd('Image:')} \`${escapeMd(flow.selection.image.slug)}\``,
    `${escapeMd('Size:')} \`${escapeMd(flow.selection.size)}\``,
    sizeInfo
      ? escapeMd(
          `Spec: ${sizeInfo.vcpus} vCPU · ${Math.round(sizeInfo.memory / 1024)} GB RAM · ${sizeInfo.disk} GB disk`,
        )
      : '',
    sizeInfo ? escapeMd(`Harga: $${sizeInfo.priceMonthly}/bulan`) : '',
    escapeMd(`Masa aktif: ${lifetimeText}`),
    '',
    '*Keamanan:*',
    ...secLines,
  ]
    .filter(Boolean)
    .join('\n');
}

async function showConfirm(ctx, _account) {
  const flow = ensureFlow(ctx);
  flow.step = 'confirm';
  const sizeInfo = flow.options.sizes?.find((s) => s.slug === flow.selection.size);
  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Buat sekarang', pack('vps', 'commit')),
      Markup.button.callback('❌ Batal', pack('vps', 'cancel')),
    ],
  ]);
  await ctx.reply(buildConfirmText(flow, sizeInfo), { parse_mode: 'MarkdownV2', ...kb });
}

// ---------------------------------------------------------- create on DO

async function commitCreate(ctx, account) {
  const flow = ensureFlow(ctx);
  const sel = flow.selection;
  const sec = sel.security ?? {};

  let password;
  if (sec.mode === 'password_random') password = generateStrongPassword(24);
  if (sec.mode === 'password_custom') password = sec.password;

  const payload = {
    name: sel.hostname,
    region: sel.region,
    size: sel.size,
    image: sel.image.slug,
    ssh_keys: sec.sshKeyIds ?? [],
    backups: false,
    ipv6: true,
    monitoring: true,
    tags: ['do-manager-bot'],
  };
  if (password) {
    payload.user_data = [
      '#cloud-config',
      'chpasswd:',
      '  list: |',
      `    root:${password}`,
      '  expire: false',
      'ssh_pwauth: True',
    ].join('\n');
  }

  const waiting = await ctx.reply('🚀 Creating droplet… ini biasanya 30–60 detik\\.', {
    parse_mode: 'MarkdownV2',
  });

  let droplet;
  try {
    const client = clientFor(account);
    const created = await client.createDroplet(payload);
    droplet = created.droplet;

    // Poll for IP address (typically appears within 30s).
    for (let i = 0; i < 30; i += 1) {
      const fresh = await client.getDroplet(droplet.id);
      const ipv4 = fresh.droplet.networks?.v4?.find((n) => n.type === 'public')?.ip_address;
      if (ipv4 && fresh.droplet.status === 'active') {
        droplet = fresh.droplet;
        break;
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'create droplet failed');
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        waiting.message_id,
        undefined,
        `❌ Gagal membuat VPS: ${err.message}`,
      )
      .catch(() => {});
    return;
  }

  const ipv4 = droplet.networks?.v4?.find((n) => n.type === 'public')?.ip_address;
  const expiresAt =
    sel.lifetimeDays > 0 ? new Date(Date.now() + sel.lifetimeDays * 86_400_000) : null;

  await Droplet.create({
    accountId: account._id,
    telegramId: ctx.from.id,
    dropletId: droplet.id,
    name: droplet.name,
    region: droplet.region?.slug,
    sizeSlug: droplet.size_slug,
    imageSlug: droplet.image?.slug ?? sel.image.slug,
    imageName: droplet.image?.name,
    ipv4,
    rootPasswordEnc: password ? encrypt(password) : undefined,
    expiresAt,
    autoDestroy: Boolean(expiresAt),
  });

  await ctx.telegram.deleteMessage(ctx.chat.id, waiting.message_id).catch(() => {});

  const detailLines = [
    '*✅ VPS berhasil dibuat\\!*',
    '',
    `Hostname: \`${escapeMd(droplet.name)}\``,
    `IP: \`${escapeMd(ipv4 ?? '—')}\``,
    `Region: \`${escapeMd(droplet.region?.slug ?? '—')}\``,
    `Size: \`${escapeMd(droplet.size_slug ?? '—')}\``,
    `Image: \`${escapeMd(droplet.image?.slug ?? '—')}\``,
    `Status: \`${escapeMd(droplet.status ?? '—')}\``,
    expiresAt
      ? `Auto-destroy: ${escapeMd(expiresAt.toISOString().slice(0, 19))} UTC`
      : 'Auto-destroy: _disabled_',
  ];
  if (password) {
    detailLines.push('', `🔐 root password: \`${escapeMd(password)}\``);
    detailLines.push('_Simpan password ini — bot tidak akan menampilkannya lagi\\._');
  }

  await ctx.reply(detailLines.join('\n'), { parse_mode: 'MarkdownV2' });

  resetFlow(ctx);

  await ctx.reply('Selesai 🎉 — kembali ke dashboard:');
  await renderDashboard(ctx, account);
}

// ------------------------------------------------------- helpers

async function sendOrEdit(ctx, text, kb) {
  const opts = { parse_mode: 'MarkdownV2', ...kb, link_preview_options: { is_disabled: true } };
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch (err) {
      logger.debug({ err: err.description }, 'edit failed, falling back to send');
    }
  }
  await ctx.reply(text, opts);
}

// ------------------------------------------------------- wiring

export function setupCreateVps(bot) {
  bot.action(/^vps:create:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const account = await getAccount(ctx.from.id, id);
    if (!account) return ctx.answerCbQuery('Account not found');
    ctx.session.activeAccountId = id;
    ctx.session.vps = { step: 'region', accountId: id, selection: {}, options: {}, page: 0 };
    await ctx.answerCbQuery();
    await showRegion(ctx, account);
  });

  bot.action(/^vps:rgnpage:page:(\d+)$/, async (ctx) => {
    const account = await activeAccount(ctx);
    if (!account) return;
    await ctx.answerCbQuery();
    await showRegion(ctx, account, Number(ctx.match[1]));
  });

  bot.action(/^vps:rgn:(.+)$/, async (ctx) => {
    const flow = ensureFlow(ctx);
    flow.selection.region = ctx.match[1];
    await ctx.answerCbQuery();
    await showImageType(ctx);
  });

  bot.action(/^vps:itype:(distribution|application)$/, async (ctx) => {
    const account = await activeAccount(ctx);
    if (!account) return;
    const flow = ensureFlow(ctx);
    flow.selection.imageType = ctx.match[1];
    await ctx.answerCbQuery();
    await showImages(ctx, account, 0);
  });

  bot.action(/^vps:imgpage:page:(\d+)$/, async (ctx) => {
    const account = await activeAccount(ctx);
    if (!account) return;
    await ctx.answerCbQuery();
    await showImages(ctx, account, Number(ctx.match[1]));
  });

  bot.action(/^vps:img:(.+)$/, async (ctx) => {
    const slug = ctx.match[1];
    const flow = ensureFlow(ctx);
    const cacheKey = flow.selection.imageType === 'application' ? 'apps' : 'distros';
    const img = (flow.options[cacheKey] ?? []).find((i) => i.slug === slug);
    flow.selection.image = img ?? { slug, name: slug };
    await ctx.answerCbQuery();
    await showSpecType(ctx);
  });

  bot.action(/^vps:imgi:(\d+)$/, async (ctx) => {
    const flow = ensureFlow(ctx);
    const cacheKey = flow.selection.imageType === 'application' ? 'apps' : 'distros';
    const img = (flow.options[cacheKey] ?? [])[Number(ctx.match[1])];
    if (!img) return ctx.answerCbQuery('Image not found');
    flow.selection.image = img;
    await ctx.answerCbQuery();
    await showSpecType(ctx);
  });

  bot.action(/^vps:spec:(regular|amd|intel)$/, async (ctx) => {
    const account = await activeAccount(ctx);
    if (!account) return;
    const flow = ensureFlow(ctx);
    flow.selection.specType = ctx.match[1];
    await ctx.answerCbQuery();
    await showSizes(ctx, account, 0);
  });

  bot.action(/^vps:szpage:page:(\d+)$/, async (ctx) => {
    const account = await activeAccount(ctx);
    if (!account) return;
    await ctx.answerCbQuery();
    await showSizes(ctx, account, Number(ctx.match[1]));
  });

  bot.action(/^vps:sz:(.+)$/, async (ctx) => {
    const account = await activeAccount(ctx);
    if (!account) return;
    const flow = ensureFlow(ctx);
    flow.selection.size = ctx.match[1];
    await ctx.answerCbQuery();
    await showSecurity(ctx, account, 0);
  });

  bot.action(/^vps:secpage:page:(\d+)$/, async (ctx) => {
    const account = await activeAccount(ctx);
    if (!account) return;
    await ctx.answerCbQuery();
    await showSecurity(ctx, account, Number(ctx.match[1]));
  });

  bot.action('vps:sec:pwr', async (ctx) => {
    const flow = ensureFlow(ctx);
    flow.selection.security = flow.selection.security ?? { sshKeyIds: [] };
    flow.selection.security.mode = 'password_random';
    flow.selection.security.password = undefined;
    await ctx.answerCbQuery('Random password ✓');
    const account = await activeAccount(ctx);
    await showSecurity(ctx, account, flow.page);
  });

  bot.action('vps:sec:pwc', async (ctx) => {
    const flow = ensureFlow(ctx);
    flow.selection.security = flow.selection.security ?? { sshKeyIds: [] };
    flow.selection.security.mode = 'password_custom';
    flow.step = 'await_password';
    await ctx.answerCbQuery();
    await ctx.reply(
      'Kirim password root yang ingin dipakai (min 8 char, harus mengandung huruf besar, kecil, angka, simbol).',
    );
  });

  bot.action(/^vps:sec:ssh:(\d+)$/, async (ctx) => {
    const flow = ensureFlow(ctx);
    flow.selection.security = flow.selection.security ?? { sshKeyIds: [] };
    const id = Number(ctx.match[1]);
    const ids = new Set(flow.selection.security.sshKeyIds ?? []);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    flow.selection.security.sshKeyIds = [...ids];
    await ctx.answerCbQuery();
    const account = await activeAccount(ctx);
    await showSecurity(ctx, account, flow.page);
  });

  bot.action('vps:sec:addssh', async (ctx) => {
    const flow = ensureFlow(ctx);
    flow.step = 'await_ssh_name';
    await ctx.answerCbQuery();
    await ctx.reply('Kirim *nama* untuk SSH key baru:', { parse_mode: 'Markdown' });
  });

  bot.action('vps:sec:done', async (ctx) => {
    const flow = ensureFlow(ctx);
    const sec = flow.selection.security ?? {};
    if (!sec.mode && (sec.sshKeyIds?.length ?? 0) === 0) {
      await ctx.answerCbQuery('Pilih minimal satu cara akses.');
      return;
    }
    await ctx.answerCbQuery();
    await askHostname(ctx);
  });

  bot.action('vps:commit', async (ctx) => {
    const account = await activeAccount(ctx);
    if (!account) return;
    await ctx.answerCbQuery('Membuat droplet…');
    try {
      ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    } catch {
      /* ignore */
    }
    await commitCreate(ctx, account);
  });

  bot.action('vps:cancel', async (ctx) => {
    resetFlow(ctx);
    await ctx.answerCbQuery('Dibatalkan');
    const account = await activeAccount(ctx);
    if (account) await renderDashboard(ctx, account, { edit: true });
    else await ctx.reply('Dibatalkan. /start untuk membuka dashboard.');
  });

  // ------- text steps -------
  bot.on('text', async (ctx, next) => {
    const flow = ctx.session?.vps;
    if (!flow) return next();
    const text = (ctx.message.text || '').trim();
    if (text.startsWith('/')) return next();

    if (flow.step === 'await_password') {
      if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(text)) {
        await ctx.reply(
          'Password belum memenuhi syarat (8+ char dengan huruf besar/kecil, angka, simbol). Coba lagi.',
        );
        return;
      }
      flow.selection.security.password = text;
      ctx.deleteMessage(ctx.message.message_id).catch(() => {});
      const account = await activeAccount(ctx);
      await ctx.reply('Password tersimpan ✓');
      await showSecurity(ctx, account, flow.page);
      return;
    }

    if (flow.step === 'await_ssh_name') {
      flow.tempSshName = text;
      flow.step = 'await_ssh_pub';
      await ctx.reply('Sekarang paste *public key* (ssh-rsa / ssh-ed25519 …):', {
        parse_mode: 'Markdown',
      });
      return;
    }

    if (flow.step === 'await_ssh_pub') {
      const account = await activeAccount(ctx);
      try {
        const client = clientFor(account);
        const { ssh_key } = await client.createSshKey({
          name: flow.tempSshName,
          publicKey: text,
        });
        flow.options.sshKeys = [
          ...(flow.options.sshKeys ?? []),
          { id: ssh_key.id, name: ssh_key.name, fingerprint: ssh_key.fingerprint },
        ];
        flow.selection.security = flow.selection.security ?? { sshKeyIds: [] };
        flow.selection.security.sshKeyIds = [
          ...(flow.selection.security.sshKeyIds ?? []),
          ssh_key.id,
        ];
        flow.tempSshName = null;
        await ctx.reply(`SSH key *${ssh_key.name}* ditambahkan ✓`, { parse_mode: 'Markdown' });
        await showSecurity(ctx, account, flow.page);
      } catch (err) {
        await ctx.reply(`Gagal menambah SSH key: ${err.message}\nCoba lagi atau /cancel.`);
      }
      return;
    }

    if (flow.step === 'await_hostname') {
      const candidate = text === 'default' ? `vps-${Date.now().toString(36)}` : text;
      if (!/^[a-zA-Z0-9.-]{1,63}$/.test(candidate)) {
        await ctx.reply('Hostname harus 1–63 char dari [a-z, A-Z, 0-9, ., -]. Coba lagi.');
        return;
      }
      flow.selection.hostname = candidate;
      await askLifetime(ctx);
      return;
    }

    if (flow.step === 'await_lifetime') {
      const n = Number(text);
      if (!Number.isFinite(n) || n < 0 || n > 365) {
        await ctx.reply('Masukkan angka antara 0 dan 365.');
        return;
      }
      flow.selection.lifetimeDays = n;
      const account = await activeAccount(ctx);
      await showConfirm(ctx, account);
      return;
    }

    return next();
  });
}

async function activeAccount(ctx) {
  const id = ctx.session.vps?.accountId ?? ctx.session.activeAccountId;
  if (!id) return null;
  return getAccount(ctx.from.id, id);
}
