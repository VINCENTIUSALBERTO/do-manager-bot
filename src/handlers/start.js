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
    await ctx.reply(
      [
        '/start – open or refresh the dashboard',
        '/accounts – list your DigitalOcean accounts',
        '/cancel – cancel the current flow (e.g. VPS creation)',
      ].join('\n'),
    );
  });

  bot.command('cancel', async (ctx) => {
    ctx.session = {};
    await ctx.reply('Flow cancelled. Send /start to open the dashboard.');
  });
}
