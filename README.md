# MagguuBot

Discord bot for the download side of a media homelab. Receives webhooks from **Sonarr / Radarr / Seerr / Tautulli / SABnzbd** and posts styled embeds into dedicated Discord channels. Single container, runs on Unraid via a custom template.

Designed to replace Notifiarr with something you own end-to-end â€” no third-party service in the loop.

## Agent rules

For automated helpers (Grok Bot / Buddy): start with `AGENTS.md`, then `CLAUDE.md`.
Buddy is the single front door; clear in-scope fixes may push/merge to `main` under
the hub standing order (no force-push; tags need an explicit release ask).

## Features

See also [CHANGELOG.md](./CHANGELOG.md).

- **Webhook receiver** â€” `/webhook/{sonarr,radarr,seerr,tautulli,sabnzbd,prowlarr,maintainerr,github}` with shared-secret / HMAC auth
- **Styled embeds** â€” one consistent look across services, posters, progress bars, lifecycle cards
- **Slash commands** â€” 51 guild commands via `/help` (downloads, moderation, utility, admin)
  - `/queue` â€” live Sonarr + Radarr download queue with progress bars
  - `/search movie <query>` / `/search show <query>` â€” Radarr / Sonarr search
  - `/setup-server` â€” idempotently scaffolds categories, channels, roles, and posts welcome banners
  - `/doctor` â€” checks configuration, channels, permissions, database, and integrations
  - `/profile` + `/wrapped` â€” XP, reputation, achievements, and shareable yearly cards
  - `/movie-night` â€” nominations, voting, countdown, and automatic reminders
- **Seerr approve / decline buttons** â€” straight from Discord (Administrator only)
- **MagguuUI release feed** â€” user-friendly addon releases go to `#addon-updates`; technical pushes and workflows stay in `#github`
- **Built-in admin dashboard** â€” Vue SPA on the same container (OAuth allowlist); not a separate Magguu-Dashboard app
- **Activity log** â€” every posted embed is written to SQLite for audit/debug
- **One container** â€” Node 24 + TS + Hono + discord.js + SQLite (WAL)
- **Discord only** â€” no Telegram/other messengers

## Stack

Node 24 Â· TypeScript 6 Â· Vue 3 Â· Vite 8 Â· discord.js 14 Â· Hono 4 Â· better-sqlite3 (WAL) Â· Drizzle Â· Zod Â· Pino

## Install on Unraid (via the custom template)

This is the recommended path â€” no docker-compose involved.

### 1. Create the Discord bot

1. <https://discord.com/developers/applications> â†’ New Application
2. **Bot** â†’ copy the token â†’ save for `DISCORD_TOKEN`
3. **Installation** â†’ Guild Install, scopes: `bot` + `applications.commands`
4. Bot permissions: `Manage Channels`, `Manage Roles`, `Send Messages`, `Embed Links`, `Read Message History`
5. Use the Install Link to add the bot to your server
6. **General Information** â†’ copy *Application ID* â†’ `DISCORD_CLIENT_ID`
7. In Discord: *User Settings* â†’ *Advanced* â†’ *Developer Mode ON*. Right-click your server â†’ *Copy Server ID* â†’ `DISCORD_GUILD_ID`

### 2. Add the template to Unraid

The image is published to GHCR by GitHub Actions after every push to `main`.

In Unraid:

1. *Docker* tab â†’ *Add Container*
2. Paste the template URL (raw XML from this repo):
   ```
   https://raw.githubusercontent.com/Derpsen/MagguuBot/main/unraid/magguu-bot.xml
   ```
   or drop `unraid/magguu-bot.xml` into `/boot/config/plugins/dockerMan/templates-user/` via a terminal / shares.
3. Fill in the required fields:
   - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
   - `WEBHOOK_SECRET` â€” generate with `openssl rand -hex 32`
   - `ADDON_REPO_FULL_NAMES` already defaults to `Derpsen/MagguuUI`
4. *Apply* â€” the image pulls from `ghcr.io/derpsen/magguu-bot:latest` and the container starts.

### 3. First boot

- Check the logs: `docker logs -f magguu-bot`
- In Discord, run `/setup-server` (as server owner / admin) â€” creates categories, channels, roles, welcome banners
- Channel IDs are discovered and stored in SQLite automatically; environment overrides are only needed for unusual custom routing
- In the Discord Developer Portal, enable the privileged **Server Members Intent** (and **Message Content Intent**). Without Server Members, join events and the `Newcomer` start role are not reliable.
- Keep the bot's highest Discord role above `Newcomer` and grant it **Manage Roles**. `/doctor` and the dashboard settings report the exact blocking role/permission issue.
- The dashboard can safely backfill the start role for roleless members who joined within the last 30 days (up to 50 per confirmed run).

### 4. Wire up the services

For each service below, set the webhook URL to `http://MagguuBot:3000/webhook/<service>` when both containers share a user-defined Docker network. Otherwise use `http://<UNRAID-IP>:3000/webhook/<service>`. Add the header `X-Magguu-Token: <your WEBHOOK_SECRET>`.

| Service | Where | Path | Notes |
|---|---|---|---|
| Sonarr | Settings â†’ Connect â†’ Webhook | `/webhook/sonarr` | Triggers: Grab, Import, Upgrade, Manual Interaction, Series/File Delete (not *For Upgrade*), Health, Application Update |
| Radarr | Settings â†’ Connect â†’ Webhook | `/webhook/radarr` | Same triggers as Sonarr |
| Seerr | Settings â†’ Notifications â†’ Webhook | `/webhook/seerr` | Use the default JSON payload template |
| Tautulli | Settings â†’ Notification Agents â†’ Webhook | `/webhook/tautulli` | Custom JSON with `"event":"{action}"` plus `sessionKey`/`ratingKey`. `{action}` `created` is treated as recently added. |
| Prowlarr | Settings â†’ Connect â†’ Webhook | `/webhook/prowlarr?token=<WEBHOOK_SECRET>` | Health + Health Restored + Application Update. Prowlarr cannot send custom headers. |

#### Seerr notification setup

Use Seerr's **Webhook** agent rather than its **Discord** agent. The Discord agent posts directly through a Discord webhook and bypasses MagguuBot's routing, approval buttons, validation, and activity log.

1. Open *Settings â†’ Notifications â†’ Webhook* and enable the agent.
2. Set **Webhook URL** to `http://MagguuBot:3000/webhook/seerr` on the same user-defined Docker network, or `http://<UNRAID-IP>:3000/webhook/seerr` otherwise.
3. Leave **Authorization Header** empty. Under **Custom Headers**, add `X-Magguu-Token` with the exact `WEBHOOK_SECRET` value from the MagguuBot container.
4. Keep the default JSON payload (use **Reset to Default** if it was customized).
5. Enable the request and issue notification types you want, save, then run Seerr's test.

Routing is automatic after `/setup-server`: pending approvals go to `â³ãƒ»freigaben`, while one public lifecycle card in `ðŸ“ãƒ»anfragen` is updated from pending through approved/declined/available/failed. Issues go to `âš ï¸ãƒ»fehler`. `SEERR_URL` and `SEERR_API_KEY` are additionally required if the Approve/Decline buttons in Discord should call back into Seerr.

`/setup-server` opens a dry-run preview by default. Review the planned channels, roles, and renames, then apply or cancel with the buttons below the preview. Its default fast mode only creates, renames, repairs, and sorts affected resources; existing correct channels are not touched. Use `full:true` only when all permissions, welcome embeds, and positions must be repaired. Passing `dry-run:false` applies the selected mode immediately. It also provisions `ðŸ“Šãƒ»wochenrÃ¼ckblick`, `ðŸ“¡ãƒ»live-downloads`, and `ðŸŽ¬ãƒ»movie-night`. The weekly digest runs according to `TIME_ZONE`, `WEEKLY_DIGEST_DAY`, and `WEEKLY_DIGEST_HOUR`; the live download card refreshes once per minute.

Failed Discord deliveries from replay-supported inbound webhooks are retried automatically after 1, 5, and 15 minutes, then 1 and 6 hours; their state remains visible in the dashboard and manual replay is still available. RSS and Blue Tracker delivery failures remain unseen and are retried on their next poll. The webhook retry count is controlled by `WEBHOOK_RETRY_MAX_ATTEMPTS`. Database backups can be downloaded with `/db-backup`; additionally, one automatic snapshot is written daily to the database directory's `backups/` folder. `AUTOMATIC_BACKUP_HOUR` and `AUTOMATIC_BACKUP_RETENTION` configure its local start hour and retention (seven by default). `/db-restore` validates size and SQLite integrity, then applies the staged restore only on the next container restart while retaining the previous database as `.pre-restore`.

Plex playback notifications are lifecycle cards: movies and episodes use one message per playback session, while music reuses one now-playing card per user and player across tracks. Pause is held for two minutes before the card flips to paused; a resume in that window never touches Discord. Watched, stop, and error still apply immediately. Add `"sessionKey":"{session_key}"` and `"ratingKey":"{rating_key}"` to every Tautulli playback JSON template for exact correlation; user, player, and title are used as a fallback. Tautulli's recently-added action is `created` â€” the bot maps that to `#neu-auf-plex`. A later stop never overwrites an already watched state, and stale events from the previous song cannot overwrite the next song. `PLEX_ACTIVITY_RETENTION_DAYS` deletes old activity cards automatically after seven days by default (`0` keeps them forever). `PLEX_STALE_SESSION_MINUTES` (default 20, `0` disables) terminates paused or stuck Tautulli sessions and closes Discord cards whose stream is gone. Enable Tautulli playback triggers **Play, Pause, Resume, Stop, Watched**. GitHub `workflow_run` successes and skipped runs are ignored; only failures, cancellations, timeouts, and action-required land in `#github`.

Sonarr/Radarr multi-episode packs (for example `S06E17-E18`) render as one grab/import card. File-deletes whose reason is an upgrade are ignored because the following import already posts an *Upgraded* card.

Other high-volume status channels use the same principle where identity is reliable: Seerr issue comments/resolution update one issue card, GitHub pull requests and issues update one card from open to closed/reopened, and Sonarr/Radarr health restoration updates the original warning. Content feeds, imports, releases, and audit/moderation logs remain append-only so history is not lost.

### 5. SABnzbd

SAB does not emit native webhooks â€” use the post-processing script:

1. Copy `scripts/sabnzbd-webhook.sh` into SAB's `scripts/` folder (Config â†’ Folders â†’ Post-Processing Scripts). On Unraid that's typically `/mnt/user/appdata/sabnzbd/scripts/`
2. `chmod +x sabnzbd-webhook.sh`
3. Set two env vars on the SABnzbd container:
   - `MAGGUU_BOT_URL=http://magguu-bot:3000`
   - `MAGGUU_TOKEN=<your WEBHOOK_SECRET>`
4. In SAB: Config â†’ Categories â†’ set **Script** = `sabnzbd-webhook.sh` on the categories you want notified (or globally on the default category)

Events: `complete` â†’ `imports` channel Â· `failed` â†’ `failures` channel.

### 6. GitHub and MagguuUI releases

Set `GITHUB_WEBHOOK_SECRET` in the container, then add a GitHub webhook that points to `<your dashboard URL>/webhook/github` with the same secret and JSON content type. Subscribe to releases plus whichever technical events you want in `#github`.

`Derpsen/MagguuUI` is recognized automatically: stable and prerelease announcements go to `#addon-updates`, while pushes, workflows, pull requests, and issues stay in `#github`. Stable releases include the current WoW version, readable notes, and links to GitHub, CurseForge, Wago, and WoWInterface. Duplicate release events are combined into one announcement, and bot posts do not open discussion threads automatically. Keep Discord FAQ/tag answers that describe MagguuUI aligned with the current MagguuUI version (EllesmereUI companion). Do not leave stale ElvUI-installer wording in those tags.

### 7. Optional admin dashboard

Expose the dashboard through a trusted HTTPS reverse proxy, then configure `DISCORD_CLIENT_SECRET`, a random 32-byte `SESSION_SECRET`, the comma-separated `ADMIN_USER_IDS` allowlist, and the exact public HTTPS origin in `DASHBOARD_BASE_URL` (no path or query). Add `<DASHBOARD_BASE_URL>/auth/callback` as a redirect in the Discord Developer Portal. The secure session cookies intentionally do not work over plain HTTP. Browser requests opened through the local Docker/Unraid URL are therefore redirected to `DASHBOARD_BASE_URL` before OAuth starts. The proxy must preserve `Host` or send `X-Forwarded-Host`, and send `X-Forwarded-Proto: https` for public requests.

A successful dashboard login remains valid for up to 30 days. Keep `SESSION_SECRET` unchanged across container updates; rotating it intentionally signs every device out.

Keep `TRUST_PROXY=false` unless every request reaches the bot through a proxy you control; otherwise clients could spoof forwarded IP headers. The exact public host/protocol headers above are used only for safe dashboard canonicalization, not as proof of identity or as a client IP.

## Development

```bash
npm install --ignore-scripts   # skips native build; enough for typecheck
npm run typecheck
npm test
npm run build
```

For a runnable dev loop use Docker â€” `better-sqlite3` needs Python + MSVC on Windows.

## Architecture

```
Sonarr / Radarr / Seerr / Tautulli / SABnzbd / Prowlarr / Maintainerr / GitHub
   â””â”€POSTâ”€â”€â–º Hono webhook routes â”€â”€â–º embed builder â”€â”€â–º discord.js â”€â”€â–º Discord channel
                     â”‚
                     â””â”€â”€â–º SQLite activity log (+ webhook retries)

Discord user â”€â”€slash cmdâ”€â”€â–º discord.js â”€â”€â–º service clients â”€â”€â–º *arr / SAB REST API
Discord user â”€â”€buttonâ”€â”€â–º Seerr approval / tickets / roles â”€â”€â–º REST + SQLite
Admin browser â”€â”€OAuthâ”€â”€â–º Vue dashboard (same origin) â”€â”€â–º /admin API
```

## File layout

```
src/
â”œâ”€â”€ index.ts                     # entry: boot discord + http server
â”œâ”€â”€ config.ts                    # zod-validated env
â”œâ”€â”€ settings.ts                  # runtime feature toggles (SQLite)
â”œâ”€â”€ db/                          # schema + WAL client + backup/restore
â”œâ”€â”€ discord/
â”‚   â”œâ”€â”€ commands/                # 51 slash commands (see CLAUDE.md)
â”‚   â”œâ”€â”€ interactions/            # Seerr, tickets, roles, suggestions, â€¦
â”‚   â”œâ”€â”€ setup via commands/setup-server.ts  # STRUCTURE + channel topics
â”‚   â””â”€â”€ channel-store.ts         # SQLite-first channel ID resolution
â”œâ”€â”€ embeds/                      # EmbedBuilder factories (no posting)
â”œâ”€â”€ server/
â”‚   â”œâ”€â”€ app.ts                   # Hono + webhook auth + static dashboard
â”‚   â”œâ”€â”€ admin/                   # dashboard API
â”‚   â””â”€â”€ webhooks/                # sonarr, radarr, seerr, tautulli, sabnzbd, prowlarr, maintainerr, github
â”œâ”€â”€ services/                    # *arr / SAB / Seerr / Tautulli / RSS clients
â””â”€â”€ utils/
frontend/                        # Vue 3 admin dashboard (Vite â†’ dist-frontend/)
scripts/sabnzbd-webhook.sh
unraid/magguu-bot.xml
.github/workflows/               # ci.yml + docker.yml (+ codeql)
```

Agent depth: `AGENTS.md` â†’ `CLAUDE.md`. Channel keys and command inventory live in `CLAUDE.md`.

## Security

- Sonarr, Radarr, Seerr, Tautulli, and SABnzbd require `X-Magguu-Token: <WEBHOOK_SECRET>` (constant-time compare)
- GitHub uses an HMAC signature with `GITHUB_WEBHOOK_SECRET`; Maintainerr requires `Authorization: Bearer <WEBHOOK_SECRET>` (preferred) or the shared secret as `?token=` and should remain internal/LAN-only
- Seerr approve / decline buttons require Administrator in Discord
- Bot token never logged; config validation fails loud on missing required vars
- `.env` / `.env.*` / `data/` / `dist/` are gitignored â€” **never commit secrets**
- Don't expose port 3000 publicly â€” stay on the internal Docker network, or wrap with Cloudflared + mTLS
- Image is multi-stage (build chain dropped) and exposes `/healthz` for container health checks
- Webhook payloads are validated with Zod before being touched

## Publishing the image (CI)

Push to `main` â†’ `.github/workflows/docker.yml` builds + pushes `ghcr.io/<owner>/magguu-bot:latest` (+ SHA tag).

Tag a release (`v1.2.3`) â†’ same image also tagged `v1.2.3` and `1.2`.

On first push you may need to flip the package visibility to public on GHCR (GitHub â†’ Packages â†’ magguu-bot â†’ Settings â†’ Change visibility) so Unraid can pull without auth.

## Extending

New service:
1. `src/services/<name>.ts` â€” API client (if needed)
2. `src/embeds/<name>.ts` â€” EmbedBuilder(s)
3. `src/server/webhooks/<name>.ts` â€” Hono route (Zod-validated payload)
4. Register in `src/server/app.ts`

New slash command:
1. `src/discord/commands/<name>.ts` â€” implement `SlashCommand`
2. Add to `all[]` in `src/discord/commands/index.ts`
