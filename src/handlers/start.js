import { Markup } from 'telegraf';

import { listAccounts } from '../services/accountService.js';
import { pack } from '../utils/callbacks.js';

import { renderDashboard } from './dashboard.js';

const API_KEY_TUTORIAL = `Welcome to *DO Manager Bot* — your control panel for DigitalOcean from Telegram\\.

To get started I need a *Personal Access Token* \\(PAT\\) from your DigitalOcean account\\. Follow these steps:

1\\. Sign in at https://cloud\\.digitalocean\\.com/account/api/tokens
2\\. Click *Generate New Token*
3\\. Give it a name, e\\.g\\. \`telegram-bot\`
4\\. Pick *Custom Scopes* and tick at least these scopes:
   • \`account:read\`
   • \`droplet:create\` \\+ \`droplet:read\` \\+ \`droplet:update\` \\+ \`droplet:delete\`
   • \`ssh_key:read\` \\+ \`ssh_key:create\`
   • \`image:read\`
   • \`region:read\`
   • \`size:read\`
   • \`billing:read\`
5\\. Click *Generate Token* and copy the value shown _once_ — DigitalOcean will not show it again\\.
6\\. Send the token to this chat as the next message\\.

🔐 _Your token is encrypted with AES\\-256\\-GCM before it touches the database — only this bot can read it back\\._`;

const HELP_TUTORIAL = `*📖 Panduan & Tutorial Penggunaan Bot*

Bot ini membantu Anda mengelola VPS DigitalOcean langsung dari Telegram dengan mudah dan aman\\.

*⚙️ Perintah Utama:*
• /start \\- Buka dashboard utama bot
• /accounts \\- Tampilkan daftar akun DigitalOcean Anda
• /cancel \\- Batalkan proses aktif \\(seperti pembuatan VPS\\)
• /help \\- Tampilkan panduan ini

*🚀 1\\. Menghubungkan Akun DigitalOcean:*
1\\. Masuk ke akun DO di https://cloud\\.digitalocean\\.com/account/api/tokens
2\\. Buat *Personal Access Token* baru \\(pastikan memiliki scope read & write\\)
3\\. Kirim token tersebut ke bot ini\\. Data token akan dienkripsi dengan aman\\.

*💻 2\\. Membuat VPS Baru:*
1\\. Klik *🚀 Create VPS* dari Dashboard
2\\. Pilih *Region* \\(lokasi server\\)
3\\. Pilih tipe OS \\(Distribution\\) atau Marketplace App
4\\. Pilih spesifikasi \\(Regular, AMD, atau Intel\\) dan ukuran plan
5\\. Tentukan metode akses: random password, custom password, atau SSH Key
6\\. Tentukan *Hostname* dan *Masa Aktif* VPS \\(dalam hari, ketik \`0\` untuk tanpa batas\\)
7\\. Konfirmasi detail pembuatan VPS\\.

*🛠 3\\. Mengelola VPS & Power Control:*
• *Reboot:* Menyalakan ulang VPS
• *Power On / Off:* Menyalakan/mematikan VPS secara dinamis \\(tombol berubah otomatis sesuai status VPS\\)
• *Destroy:* Menghapus VPS permanen \\(tindakan ini tidak bisa dibatalkan\\)
• *Rebuild:* Menginstall ulang OS tanpa mengubah IP address VPS
• *Show Password:* Menampilkan password root tersimpan \\(pesan password otomatis dihapus dalam 60 detik\\)

*📅 4\\. Masa Aktif & Grace Period:*
• *Sisa Masa Aktif* akan ditampilkan pada halaman info VPS secara detail dalam Waktu Indonesia Barat \\(WIB\\)\\.
• Tombol *📅 Perpanjang Masa Aktif* dapat digunakan kapan saja untuk menambah masa aktif VPS\\.
• Jika VPS mencapai tanggal expired, VPS *tidak langsung dihapus*\\. Bot akan mematikan VPS \\(*Power Off*\\) dan memberikan masa tenggang selama *7 hari*\\.
• Selama 7 hari tersebut, Anda bisa memperpanjang masa aktif untuk menyalakan kembali VPS\\.
• Jika dalam 7 hari tidak diperpanjang, VPS akan dihapus otomatis secara permanen\\.

_Butuh bantuan lebih lanjut? Silakan ketik /start untuk kembali ke dashboard utama\\._`;

export function setupStart(bot) {
  bot.command('start', async (ctx) => {
    const accounts = await listAccounts(ctx.from.id);
    if (accounts.length === 0) {
      ctx.session.flow = 'awaiting_token';
      ctx.session.tokenLabel = null;
      await ctx.replyWithMarkdownV2(API_KEY_TUTORIAL, {
        link_preview_options: { is_disabled: true },
      });
      return;
    }

    if (accounts.length === 1) {
      ctx.session.activeAccountId = String(accounts[0]._id);
      await renderDashboard(ctx, accounts[0]);
      return;
    }

    const buttons = accounts.map((a) =>
      Markup.button.callback(a.label, pack('acct', 'open', String(a._id))),
    );
    buttons.push(Markup.button.callback('➕ Add Account', pack('acct', 'add')));
    await ctx.reply(
      'Pilih akun DigitalOcean yang ingin kamu kelola:',
      Markup.inlineKeyboard(buttons, { columns: 2 }),
    );
  });

  bot.command('help', async (ctx) => {
    const accounts = await listAccounts(ctx.from.id);
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '⬅️ Menu Utama',
          accounts.length > 0
            ? pack('acct', 'open', ctx.session.activeAccountId || String(accounts[0]._id))
            : 'vps:cancel',
        ),
      ],
    ]);
    await ctx.replyWithMarkdownV2(HELP_TUTORIAL, {
      link_preview_options: { is_disabled: true },
      ...kb,
    });
  });

  bot.action('help:show', async (ctx) => {
    await ctx.answerCbQuery();
    const accounts = await listAccounts(ctx.from.id);
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '⬅️ Kembali',
          accounts.length > 0
            ? pack('acct', 'open', ctx.session.activeAccountId || String(accounts[0]._id))
            : 'vps:cancel',
        ),
      ],
    ]);
    try {
      await ctx.editMessageText(HELP_TUTORIAL, {
        parse_mode: 'MarkdownV2',
        link_preview_options: { is_disabled: true },
        ...kb,
      });
    } catch {
      await ctx.replyWithMarkdownV2(HELP_TUTORIAL, {
        link_preview_options: { is_disabled: true },
        ...kb,
      });
    }
  });

  bot.command('cancel', async (ctx) => {
    ctx.session = {};
    await ctx.reply('Flow cancelled. Send /start to open the dashboard.');
  });
}
