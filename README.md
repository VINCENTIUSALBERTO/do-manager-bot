# DO Manager Bot

A production-ready Telegram bot for managing **DigitalOcean** accounts, droplets, billing and SSH keys, built with **Node.js**, **Telegraf** and **MongoDB Atlas**.

## Features

- Multi-account: each Telegram user can connect more than one DigitalOcean account.
- API tokens are encrypted at rest with **AES-256-GCM**.
- Dashboard with account info: name, email, balance, MTD usage, droplet count.
- Guided **Create VPS** wizard:
  - Region picker (auto-filtered to regions with stock).
  - OS distribution **or** Marketplace app images.
  - Spec family: Regular / AMD / Intel.
  - Size picker with vCPU / RAM / disk / price.
  - Security: random password, custom password, existing SSH keys (multi-select), or add a new SSH key on the fly.
  - Hostname + optional auto-destroy lifetime in days.
  - Final confirmation before any DO API call is made.
- **Manage VPS**: list, view, reboot, power on/off, destroy (with confirmation), reveal stored root password.
- Auto-destroy scheduler: droplets with `expiresAt` get a 1-hour warning and are deleted on schedule.
- Allow-list for Telegram user IDs.
- Graceful shutdown, structured logging via `pino`.

## Quick start

### 1. Prerequisites

- Node.js **20+**
- A free MongoDB Atlas cluster (or any MongoDB instance reachable via URI)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### 2. Configure

```bash
cp .env.example .env
# Then fill in BOT_TOKEN, MONGODB_URI and ENCRYPTION_KEY.
# Generate an encryption key:
openssl rand -hex 32
```

### 3. Run locally

```bash
npm install
npm run dev      # auto-reload on file change
# or
npm start
```

The bot will start polling Telegram. Open it in Telegram and send `/start`.

### 4. Add your first DigitalOcean account

When you `/start` with no accounts, the bot walks you through generating a DigitalOcean Personal Access Token with the right scopes. Paste the token back into the chat — the message is auto-deleted and the token is encrypted with AES-256-GCM before being stored.

### 5. Production deployment

The repo ships with a slim multi-stage `Dockerfile` and a `docker-compose.yml` for one-command deploys. Build and run:

```bash
docker compose up -d --build
```

Set the env variables in `.env` (or pass them via your orchestrator). The container starts the bot in long-polling mode and auto-restarts on failure.

#### Required environment variables

| Var                | Required | Description                                                                                   |
| ------------------ | -------- | --------------------------------------------------------------------------------------------- |
| `BOT_TOKEN`        | yes      | Telegram bot token from BotFather                                                             |
| `MONGODB_URI`      | yes      | Mongo connection string (Atlas SRV URL is fine)                                               |
| `ENCRYPTION_KEY`   | yes      | 32-byte hex (64 chars) AES-256-GCM key                                                        |
| `ALLOWED_USER_IDS` | no       | Comma-separated Telegram user IDs allowed to use the bot. Empty = everyone (NOT recommended). |
| `LOG_LEVEL`        | no       | `info` by default                                                                             |
| `NODE_ENV`         | no       | `production` disables pretty logging                                                          |
| `EXPIRY_CRON`      | no       | Cron schedule for the auto-destroy sweeper. Default `*/1 * * * *`.                            |

## Commands

| Command     | What it does                                   |
| ----------- | ---------------------------------------------- |
| `/start`    | Show dashboard or run onboarding               |
| `/accounts` | Switch between connected DigitalOcean accounts |
| `/cancel`   | Cancel the current flow (e.g. VPS creation)    |
| `/help`     | Show command list                              |

## Project layout

```
src/
  index.js              # entry point: connects DB, launches bot, starts cron
  bot.js                # Telegraf wiring
  config.js             # zod-validated env config
  logger.js             # pino instance
  db.js                 # mongoose connection
  handlers/             # one file per high-level Telegram flow
    start.js            # /start + tutorial
    addAccount.js       # token capture text handler
    dashboard.js        # account dashboard rendering
    createVps.js        # multi-step VPS creation wizard
    manageVps.js        # list / view / actions on droplets
  middleware/
    auth.js             # allow-list + User upsert
    errorHandler.js     # bot.catch
  models/               # mongoose schemas
  services/
    crypto.js           # AES-256-GCM encrypt/decrypt + password gen
    digitalocean.js     # DO v2 API client
    accountService.js   # CRUD + DO sync for stored accounts
    session.js          # Mongo-backed Telegraf session
    expirySweeper.js    # node-cron auto-destroy job
  utils/
    callbacks.js        # pack/unpack helpers for inline callback_data
    keyboards.js        # paginated inline keyboards
    format.js           # Markdown V2 escape + money/byte/region helpers
```

## Security notes

- DigitalOcean tokens are stored _only_ as AES-256-GCM ciphertext. Losing
  `ENCRYPTION_KEY` will make stored tokens unreadable — rotate carefully.
- Root passwords generated by the bot are encrypted with the same key.
- Tokens entered into Telegram chat are auto-deleted from the chat after a
  successful verify. Custom passwords typed during the create-VPS flow are
  treated the same way.
- The bot supports an `ALLOWED_USER_IDS` allow-list — leave it empty only for
  internal testing.

## License

MIT
