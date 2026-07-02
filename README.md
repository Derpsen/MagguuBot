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
  - `/doctor` — checks configuration, channels, permissions, database, and integrations
  - `/profile` + `/wrapped` — XP, reputation, achievements, and shareable yearly cards
  - `/movie-night` — nominations, voting, countdown, and automatic reminders
- **Seerr approve / decline buttons** — straight from Discord (Administrator only)
- **MagguuUI release feed** — user-friendly addon releases go to `#addon-updates`; technical pushes and workflows stay in `#github`
- **Activity log** — every posted embed is written to SQLite for audit/debug
- **One container** — Node 24 + TS + Hono + discord.js + SQLite (WAL)

## Stack

Node 24 · TypeScript 6 · Vue 3 · Vite 8 · discord.js 14 · Hono 4 · better-sqlite3 (WAL) · Drizzle · Zod · Pino

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
   - `ADDON_REPO_FULL_NAMES` already defaults to `Derpsen/MagguuUI`
4. *Apply* — the image pulls from `ghcr.io/derpsen/magguu-bot:latest` and the container starts.

### 3. First boot

- Check the logs: `docker logs -f magguu-bot`
- In Discord, run `/setup-server` (as server owner / admin) — creates categories, channels, roles, welcome banners
- Channel IDs are discovered and stored in SQLite automatically; environment overrides are only needed for unusual custom routing

### 4. Wire up the services

For each service below, set the webhook URL to `http://MagguuBot:3000/webhook/<service>` when both containers share a user-defined Docker network. Otherwise use `http://<UNRAID-IP>:3000/webhook/<service>`. Add the header `X-Magguu-Token: <your WEBHOOK_SECRET>`.

| Service | Where | Path | Notes |
|---|---|---|---|
| Sonarr | Settings → Connect → Webhook | `/webhook/sonarr` | Triggers: Grab, Download, Import Failure, Manual Interaction, Health |
| Radarr | Settings → Connect → Webhook | `/webhook/radarr` | Same triggers as Sonarr |
| Seerr | Settings → Notifications → Webhook | `/webhook/seerr` | Use the default JSON payload template |
| Tautulli | Settings → Notification Agents → Webhook | `/webhook/tautulli` | JSON payload: `{"event":"recently_added","title":"{title}","year":"{year}","mediaType":"{media_type}","summary":"{summary}","posterUrl":"{poster_url}","serverName":"{server_name}"}` |

#### Seerr notification setup

Use Seerr's **Webhook** agent rather than its **Discord** agent. The Discord agent posts directly through a Discord webhook and bypasses MagguuBot's routing, approval buttons, validation, and activity log.

1. Open *Settings → Notifications → Webhook* and enable the agent.
2. Set **Webhook URL** to `http://MagguuBot:3000/webhook/seerr` on the same user-defined Docker network, or `http://<UNRAID-IP>:3000/webhook/seerr` otherwise.
3. Leave **Authorization Header** empty. Under **Custom Headers**, add `X-Magguu-Token` with the exact `WEBHOOK_SECRET` value from the MagguuBot container.
4. Keep the default JSON payload (use **Reset to Default** if it was customized).
5. Enable the request and issue notification types you want, save, then run Seerr's test.

Routing is automatic after `/setup-server`: pending approvals go to `⏳・freigaben`, while one public lifecycle card in `📝・anfragen` is updated from pending through approved/declined/available/failed. Issues go to `⚠️・fehler`. `SEERR_URL` and `SEERR_API_KEY` are additionally required if the Approve/Decline buttons in Discord should call back into Seerr.

`/setup-server` now opens a dry-run preview by default. Review the planned channels, roles, and renames, then apply or cancel with the buttons below the preview. Passing `dry-run:false` still applies the setup immediately. It also provisions `📊・wochenrückblick`, `📡・live-downloads`, and `🎬・movie-night`. The weekly digest runs according to `TIME_ZONE`, `WEEKLY_DIGEST_DAY`, and `WEEKLY_DIGEST_HOUR`; the live download card refreshes once per minute.

Failed webhook events are retried automatically after 1, 5, and 15 minutes, then 1 and 6 hours; their state remains visible in the dashboard and manual replay is still available. The retry count is controlled by `WEBHOOK_RETRY_MAX_ATTEMPTS`. Database backups can be downloaded with `/db-backup`; additionally, one automatic snapshot is written daily to the database directory's `backups/` folder. `AUTOMATIC_BACKUP_HOUR` and `AUTOMATIC_BACKUP_RETENTION` configure its local start hour and retention (seven by default). `/db-restore` validates size and SQLite integrity, then applies the staged restore only on the next container restart while retaining the previous database as `.pre-restore`.

Plex playback notifications are lifecycle cards: play creates one Discord message, while pause, resume, buffer, watched, and stop update that same message. Add `"sessionKey":"{session_key}"` and `"ratingKey":"{rating_key}"` to every Tautulli playback JSON template for exact correlation; user, player, and title are used as a fallback. A later stop never overwrites an already watched state. `PLEX_ACTIVITY_RETENTION_DAYS` deletes old activity cards automatically after seven days by default (`0` keeps them forever).

### 5. SABnzbd

SAB does not emit native webhooks — use the post-processing script:

1. Copy `scripts/sabnzbd-webhook.sh` into SAB's `scripts/` folder (Config → Folders → Post-Processing Scripts). On Unraid that's typically `/mnt/user/appdata/sabnzbd/scripts/`
2. `chmod +x sabnzbd-webhook.sh`
3. Set two env vars on the SABnzbd container:
   - `MAGGUU_BOT_URL=http://magguu-bot:3000`
   - `MAGGUU_TOKEN=<your WEBHOOK_SECRET>`
4. In SAB: Config → Categories → set **Script** = `sabnzbd-webhook.sh` on the categories you want notified (or globally on the default category)

Events: `complete` → `imports` channel · `failed` → `failures` channel.

### 6. GitHub and MagguuUI releases

Set `GITHUB_WEBHOOK_SECRET` in the container, then add a GitHub webhook that points to `<your dashboard URL>/webhook/github` with the same secret and JSON content type. Subscribe to releases plus whichever technical events you want in `#github`.

`Derpsen/MagguuUI` is recognized automatically: stable and prerelease announcements go to `#addon-updates`, while pushes, workflows, pull requests, and issues stay in `#github`. Stable releases include the current WoW version, readable notes, and links to GitHub, CurseForge, Wago, and WoWInterface. Duplicate release events are combined into one announcement, and bot posts do not open discussion threads automatically.

### 7. Optional admin dashboard

Expose the dashboard through a trusted HTTPS reverse proxy, then configure `DISCORD_CLIENT_SECRET`, a random 32-byte `SESSION_SECRET`, the comma-separated `ADMIN_USER_IDS` allowlist, and the exact public `DASHBOARD_BASE_URL`. Add `<DASHBOARD_BASE_URL>/auth/callback` as a redirect in the Discord Developer Portal. The secure session cookies intentionally do not work over plain HTTP.

Keep `TRUST_PROXY=false` unless every request reaches the bot through a proxy you control; otherwise clients could spoof forwarded IP headers.

## Development

```bash
npm install --ignore-scripts   # skips native build; enough for typecheck
npm run typecheck
npm test
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
│   └── sabnzbd.ts
└── utils/
    └── logger.ts                   # pino

scripts/
└── sabnzbd-webhook.sh              # SAB post-processing hook
unraid/
└── magguu-bot.xml                  # community template
.github/workflows/
├── ci.yml                          # audit + typecheck + tests + build
└── docker.yml                      # build + push to GHCR
```

## Security

- Sonarr, Radarr, Seerr, Tautulli, and SABnzbd require `X-Magguu-Token: <WEBHOOK_SECRET>` (constant-time compare)
- GitHub uses an HMAC signature with `GITHUB_WEBHOOK_SECRET`; Maintainerr requires `Authorization: Bearer <WEBHOOK_SECRET>` (preferred) or the shared secret as `?token=` and should remain internal/LAN-only
- Seerr approve / decline buttons require Administrator in Discord
- Bot token never logged; config validation fails loud on missing required vars
- `.env` / `.env.*` / `data/` / `dist/` are gitignored — **never commit secrets**
- Don't expose port 3000 publicly — stay on the internal Docker network, or wrap with Cloudflared + mTLS
- Image is multi-stage (build chain dropped) and exposes `/healthz` for container health checks
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
