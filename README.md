# MagguuBot

Discord bot for the download side of a media homelab. Receives webhooks from **Sonarr / Radarr / Seerr / Tautulli / SABnzbd** and posts styled embeds into dedicated Discord channels. Single container, runs on Unraid via a custom template.

Designed to replace Notifiarr with something you own end-to-end — no third-party service in the loop.

## Features

- **Webhook receiver** — `/webhook/{sonarr,radarr,seerr,tautulli,sabnzbd}` with shared-secret auth
- **Styled embeds** — one consistent look across services, posters, progress bars
- **Slash commands**
  - `/queue` — live Sonarr + Radarr + SABnzbd download queue with progress bars
  - `/search movie <query>` / `/search show <query>` — Radarr / Sonarr search
  - `/setup-server` — idempotently scaffolds categories, channels, roles, and posts welcome banners
- **Seerr approve / decline buttons** — straight from Discord (Administrator only)
- **Activity log** — every posted embed is written to SQLite for audit/debug
- **One container** — Node 24 + TS + Hono + discord.js + SQLite (WAL)

## Stack

Node 24 · TypeScript 5.7 · discord.js 14 · Hono 4 · better-sqlite3 (WAL) · Drizzle · Zod · Pino

## Install on Unraid (via the custom template)

This is the recommended path — no docker-compose involved.

### 1. Create the Discord bot

1. <https://discord.com/developers/applications> → New Application
2. **Bot** → copy the token → save for `DISCORD_TOKEN`
3. **Installation** → Guild Install, scopes: `bot` + `applications.commands`
4. Bot permissions: `Manage Channels`, `Manage Roles`, `Send Messages`, `Embed Links`, `Read Message History`
5. Use the Install Link to add the bot to your server
6. **General Information** → copy *Application ID* → `DISCORD_CLIENT_ID`
7. In Discord: *User Settings* → *Advanced* → *Developer Mode ON*. Right-click your server → *Copy Server ID* → `DISCORD_GUILD_ID`

### 2. Add the template to Unraid

The image is published to GHCR by GitHub Actions after every push to `main`.

In Unraid:

1. *Docker* tab → *Add Container*
2. Paste the template URL (raw XML from this repo):
   ```
   https://raw.githubusercontent.com/Derpsen/MagguuBot/main/unraid/magguu-bot.xml
   ```
   or drop `unraid/magguu-bot.xml` into `/boot/config/plugins/dockerMan/templates-user/` via a terminal / shares.
3. Fill in the required fields:
   - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
   - `WEBHOOK_SECRET` — generate with `openssl rand -hex 32`
   - Leave channel IDs empty for now
4. *Apply* — the image pulls from `ghcr.io/derpsen/magguu-bot:latest` and the container starts.

### 3. First boot

- Check the logs: `docker logs -f magguu-bot`
- In Discord, run `/setup-server` (as server owner / admin) — creates categories, channels, roles, welcome banners
- Copy the channel IDs (right-click each channel → *Copy Channel ID*) and paste into the template env vars: `DISCORD_CHANNEL_GRABS`, `DISCORD_CHANNEL_IMPORTS`, etc.
- Apply → the container restarts

### 4. Wire up the services

For each service below, set the webhook URL to `http://magguu-bot:3000/webhook/<service>` (same Docker network) and add header `X-Magguu-Token: <your WEBHOOK_SECRET>`.

| Service | Where | Path | Notes |
|---|---|---|---|
| Sonarr | Settings → Connect → Webhook | `/webhook/sonarr` | Triggers: Grab, Download, Import Failure, Manual Interaction, Health |
| Radarr | Settings → Connect → Webhook | `/webhook/radarr` | Same triggers as Sonarr |
| Seerr | Settings → Notifications → Webhook | `/webhook/seerr` | Use the default JSON payload template |
| Tautulli | Settings → Notification Agents → Webhook | `/webhook/tautulli` | JSON payload: `{"event":"recently_added","title":"{title}","year":"{year}","mediaType":"{media_type}","summary":"{summary}","posterUrl":"{poster_url}","serverName":"{server_name}"}` |

### 5. SABnzbd

SAB does not emit native webhooks — use the post-processing script:

1. Copy `scripts/sabnzbd-webhook.sh` into SAB's `scripts/` folder (Config → Folders → Post-Processing Scripts). On Unraid that's typically `/mnt/user/appdata/sabnzbd/scripts/`
2. `chmod +x sabnzbd-webhook.sh`
3. Set two env vars on the SABnzbd container:
   - `MAGGUU_BOT_URL=http://magguu-bot:3000`
   - `MAGGUU_TOKEN=<your WEBHOOK_SECRET>`
4. In SAB: Config → Categories → set **Script** = `sabnzbd-webhook.sh` on the categories you want notified (or globally on the default category)

Events: `complete` → `imports` channel · `failed` → `failures` channel.

## Development

```bash
npm install --ignore-scripts   # skips native build; enough for typecheck
npm run typecheck
npm run build
```

For a runnable dev loop use Docker — `better-sqlite3` needs Python + MSVC on Windows.

## Architecture

```
Sonarr / Radarr / Seerr / Tautulli / SABnzbd
   └─POST──► Hono webhook routes ──► embed builder ──► discord.js ──► Discord channel
                     │
                     └──► SQLite activity log

Discord user ──slash cmd──► discord.js ──► service clients ──► *arr / SAB REST API
Discord user ──button──► Seerr approval handler ──► Seerr REST API
```

## File layout

```
src/
├── index.ts                        # entry: boot discord + http server
├── config.ts                       # zod-validated env
├── db/
│   ├── schema.ts                   # drizzle schema (webhook_events, seerr_requests)
│   └── client.ts                   # better-sqlite3 + WAL + idempotent schema init
├── discord/
│   ├── client.ts                   # discord.js client, command registration
│   ├── commands/
│   │   ├── index.ts
│   │   ├── queue.ts                # /queue — sonarr+radarr+sab live queue
│   │   ├── search.ts               # /search movie|show
│   │   └── setup-server.ts         # /setup-server — scaffolds + welcome banners
│   └── interactions/
│       └── seerr-buttons.ts        # approve/decline handler
├── embeds/
│   ├── colors.ts                   # brand colors + formatBytes + truncate
│   ├── arr.ts                      # grab/import/failure/health embeds
│   ├── seerr.ts                    # request embeds + buttons
│   ├── sabnzbd.ts                  # SAB event embeds
│   └── queue.ts                    # /queue embed
├── server/
│   ├── app.ts                      # Hono app + shared-secret middleware
│   ├── discord-poster.ts           # post + log every embed
│   └── webhooks/
│       ├── sonarr.ts
│       ├── radarr.ts
│       ├── seerr.ts
│       ├── tautulli.ts
│       └── sabnzbd.ts
├── services/
│   ├── arr-client.ts               # shared fetch wrapper
│   ├── sonarr.ts
│   ├── radarr.ts
│   ├── seerr.ts
│   ├── sabnzbd.ts
│   └── tmdb.ts
└── utils/
    └── logger.ts                   # pino

scripts/
└── sabnzbd-webhook.sh              # SAB post-processing hook
unraid/
└── magguu-bot.xml                  # community template
.github/workflows/
├── ci.yml                          # typecheck + build
└── docker.yml                      # build + push to GHCR
```

## Security

- All `/webhook/*` routes require `X-Magguu-Token: <WEBHOOK_SECRET>` (constant-time compare)
- Seerr approve / decline buttons require Administrator in Discord
- Bot token never logged; config validation fails loud on missing required vars
- `.env` / `.env.*` / `data/` / `dist/` are gitignored — **never commit secrets**
- Don't expose port 3000 publicly — stay on the internal Docker network, or wrap with Cloudflared + mTLS
- Image is multi-stage (build chain dropped); runtime runs as `node` user, not root
- Webhook payloads are validated with Zod before being touched

## Publishing the image (CI)

Push to `main` → `.github/workflows/docker.yml` builds + pushes `ghcr.io/<owner>/magguu-bot:latest` (+ SHA tag).

Tag a release (`v1.2.3`) → same image also tagged `v1.2.3` and `1.2`.

On first push you may need to flip the package visibility to public on GHCR (GitHub → Packages → magguu-bot → Settings → Change visibility) so Unraid can pull without auth.

## Extending

New service:
1. `src/services/<name>.ts` — API client (if needed)
2. `src/embeds/<name>.ts` — EmbedBuilder(s)
3. `src/server/webhooks/<name>.ts` — Hono route (Zod-validated payload)
4. Register in `src/server/app.ts`

New slash command:
1. `src/discord/commands/<name>.ts` — implement `SlashCommand`
2. Add to `all[]` in `src/discord/commands/index.ts`
