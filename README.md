# MagguuBot

Discord bot for the download side of a media homelab. Receives webhooks from **Sonarr / Radarr / Seerr / Tautulli / SABnzbd** and posts styled embeds into dedicated Discord channels. Single container, runs on Unraid via a custom template.

Designed to replace Notifiarr with something you own end-to-end — no third-party service in the loop.

## Agent rules

For automated helpers (Grok Bot / Buddy): start with `AGENTS.md`.
Buddy is the single front door; clear in-scope fixes may push/merge to `main` under
the hub standing order (no force-push; tags need an explicit release ask).

## Features

See also [CHANGELOG.md](./CHANGELOG.md).

- **Webhook receiver** — `/webhook/{sonarr,radarr,seerr,tautulli,sabnzbd,prowlarr,github}` with shared-secret / HMAC auth
- **Styled embeds** — one consistent look across services, posters, progress bars, lifecycle cards
- **Slash commands** — 56 guild commands via `/help` (downloads, moderation, utility, admin)
  - `/queue` — live Sonarr + Radarr download queue with progress bars
  - `/search movie <query>` / `/search show <query>` — Radarr / Sonarr search
  - `/setup-server` — idempotently scaffolds categories, channels, roles, and posts welcome banners
  - `/doctor` — checks configuration, channels, permissions, database, and integrations
  - `/profile` + `/wrapped` — XP, reputation, achievements, and shareable yearly cards
  - `/movie-night` — nominations, voting, countdown, and automatic reminders
- **Seerr approve / decline buttons** — straight from Discord (Administrator only)
- **MagguuUI release feed** — user-friendly addon releases go to `#addon-updates`; technical pushes and workflows stay in `#github`
- **Built-in admin dashboard** — Vue SPA on the same container (OAuth allowlist); not a separate Magguu-Dashboard app
- **Activity log** — every posted embed is written to SQLite for audit/debug
- **One container** — Node 26 + TS + Hono + discord.js + SQLite (WAL)
- **Discord only** — no Telegram/other messengers

## Stack

Node 26 · TypeScript 6 · Vue 3 · Vite 8 · discord.js 14 · Hono 4 · better-sqlite3 (WAL) · Drizzle · Zod · Pino

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
- In the Discord Developer Portal, enable the privileged **Server Members Intent** (and **Message Content Intent**). Without Server Members, join events and the `Newcomer` start role are not reliable.
- Keep the bot's highest Discord role above `Newcomer` and grant it **Manage Roles**. `/doctor` and the dashboard settings report the exact blocking role/permission issue.
- The dashboard can safely backfill the start role for roleless members who joined within the last 30 days (up to 50 per confirmed run).

### 4. Wire up the services

For each service below, set the webhook URL to `http://MagguuBot:3000/webhook/<service>` when both containers share a user-defined Docker network. Otherwise use `http://<UNRAID-IP>:3000/webhook/<service>`. Add the header `X-Magguu-Token: <your WEBHOOK_SECRET>`.

| Service | Where | Path | Notes |
|---|---|---|---|
| Sonarr | Settings → Connect → Webhook | `/webhook/sonarr` | Triggers: Grab, Import, Upgrade, Manual Interaction, Series/File Delete (not *For Upgrade*), Health, Application Update |
| Radarr | Settings → Connect → Webhook | `/webhook/radarr` | Same triggers as Sonarr |
| Seerr | Settings → Notifications → Webhook | `/webhook/seerr` | Use the default JSON payload template |
| Tautulli | Settings → Notification Agents → Webhook | `/webhook/tautulli` | Custom JSON with `"event":"{action}"` plus `sessionKey`/`ratingKey`. `{action}` `created` is treated as recently added. |
| Prowlarr | Settings → Connect → Webhook | `/webhook/prowlarr?token=<WEBHOOK_SECRET>` | Health + Health Restored + Application Update. Prowlarr cannot send custom headers. |

#### Seerr notification setup

Use Seerr's **Webhook** agent rather than its **Discord** agent. The Discord agent posts directly through a Discord webhook and bypasses MagguuBot's routing, approval buttons, validation, and activity log.

1. Open *Settings → Notifications → Webhook* and enable the agent.
2. Set **Webhook URL** to `http://MagguuBot:3000/webhook/seerr` on the same user-defined Docker network, or `http://<UNRAID-IP>:3000/webhook/seerr` otherwise.
3. Leave **Authorization Header** empty. Under **Custom Headers**, add `X-Magguu-Token` with the exact `WEBHOOK_SECRET` value from the MagguuBot container.
4. Keep the default JSON payload (use **Reset to Default** if it was customized).
5. Enable the request and issue notification types you want, save, then run Seerr's test.

Routing is automatic after `/setup-server`: pending approvals go to `⏳・freigaben`, while one public lifecycle card in `📝・anfragen` is updated from pending through approved/declined/available/failed. Issues go to `🩺・status`. `SEERR_URL` and `SEERR_API_KEY` are additionally required if the Approve/Decline buttons in Discord should call back into Seerr.

`/setup-server` opens a dry-run preview by default. Review the planned renames, moves, archive moves and key changes, then apply or cancel with the buttons below the preview. It brings the server to the lean layout in `src/discord/server-layout.ts` (5 categories, 17 channels, 11 roles), reuses existing channels and roles via `oldNames`, moves everything else into `🗄️ ARCHIV` and never deletes anything. `full:true` re-renders all pinned panels; `dry-run:false` applies immediately. The one-shot rollout CLI (`node dist/rollout/discord-rollout.js --dry-run|--apply`, run inside the container) additionally enables Community, onboarding and the welcome screen; final deletion of archived channels and empty roles is a separate `--delete-archived` step gated by `DELETE_APPROVED=yes`. The weekly digest runs according to `TIME_ZONE`, `WEEKLY_DIGEST_DAY`, and `WEEKLY_DIGEST_HOUR`; the Plex weekly statistics card (top titles, most active users, plays and watch hours of the last 7 days from Tautulli) runs according to `TIME_ZONE`, `PLEX_WEEKLY_DAY` (default Monday), `PLEX_WEEKLY_HOUR` (default 08:00) and `PLEX_WEEKLY_ENABLED`, lives in `#neu-auf-plex` (or `DISCORD_CHANNEL_PLEX_WEEKLY`), is one message that is edited in place (id stored in SQLite `plex_weekly_card`, unchanged content is not touched, reposted only if the message was deleted) and can be refreshed with `/wochenstatistik`; `/neu` lists the new movies/series of the last 1-30 days (Tautulli recently added, 5 min cache, paginated, ephemeral); Tautulli errors are only logged; the live download card refreshes once per minute. Pinned info cards are rolled out with `node dist/rollout/discord-cards.js --dry-run|--apply`, and `node dist/rollout/discord-acceptance.js --dry-run|--apply|--report` runs the end-to-end acceptance check (routing test posts, 90-day scan, slash commands, tickets, permissions, stored IDs).

Failed Discord deliveries from replay-supported inbound webhooks are retried automatically after 1, 5, and 15 minutes, then 1 and 6 hours; their state remains visible in the dashboard and manual replay is still available. RSS and Blue Tracker delivery failures remain unseen and are retried on their next poll. The webhook retry count is controlled by `WEBHOOK_RETRY_MAX_ATTEMPTS`. Database backups can be downloaded with `/db-backup`; additionally, one automatic snapshot is written daily to the database directory's `backups/` folder. `AUTOMATIC_BACKUP_HOUR` and `AUTOMATIC_BACKUP_RETENTION` configure its local start hour and retention (seven by default). `/db-restore` validates size and SQLite integrity, then applies the staged restore only on the next container restart while retaining the previous database as `.pre-restore`.

Plex playback notifications live in **one card** in `🎬・plex-aktivität`: it lists running sessions (▶️ playing, ⏸️ paused, 🔄 buffering) and the last few finished ones, and is **edited in place**; playback events never post a message of their own. The message id is stored in SQLite (`plex_activity_card`), so a restart keeps editing the same card. A burst of events becomes one edit (4 s debounce, at most 15 s wait), an unchanged card is not touched, and a new message is only posted when none exists yet or Discord says the old one is gone (Unknown Message) or edits keep failing (at most one repost per 10 min). Include `"sessionKey":"{session_key}"` in custom Tautulli JSON templates for exact correlation; the Discord-format agent is matched by user + player. Tautulli's recently-added action is `created` — the bot maps that to `#neu-auf-plex`. A later stop never overwrites an already watched state, and stale events from the previous song cannot overwrite the next song. `PLEX_ACTIVITY_RETENTION_DAYS` deletes old, tracked per-event activity cards from before the single-card change after seven days by default (`0` keeps them); the single card itself is never deleted by the bot. `PLEX_STALE_SESSION_MINUTES` (default 20, `0` disables) terminates paused or stuck Tautulli sessions and moves sessions whose stream is gone from the card to "Zuletzt". Enable Tautulli playback triggers **Play, Pause, Resume, Stop, Watched**. GitHub `workflow_run` successes and skipped runs are ignored; only failures, cancellations, timeouts, and action-required land in the `github` channel (`🩺・status`).

Once a week (default Friday 18:00 in `TIME_ZONE`; `PLEX_NEW_DIGEST_ENABLED`, `PLEX_NEW_DIGEST_DAY`, `PLEX_NEW_DIGEST_HOUR`) the bot posts **one** "🆕 Neu hinzugefügt" embed with the movies and series added since the previous digest (Tautulli `get_recently_added`, at most 15 titles plus `+N weitere`); if nothing is new, nothing is posted. The channel is `DISCORD_CHANNEL_NEW_ADDED`, otherwise the New-on-Plex channel, otherwise the weekly digest channel. The last run is stored in SQLite (`plex_new_digest`), so a restart never posts a digest twice.

Sonarr/Radarr multi-episode packs (for example `S06E17-E18`) render as one grab/import card. File-deletes whose reason is an upgrade are ignored because the following import already posts an *Upgraded* card.

Other high-volume status channels use the same principle where identity is reliable: Seerr issue comments/resolution update one issue card, GitHub pull requests and issues update one card from open to closed/reopened, and Sonarr/Radarr health restoration updates the original warning. Content feeds, imports, releases, and audit/moderation logs remain append-only so history is not lost.

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

`Derpsen/MagguuUI` is recognized automatically: stable and prerelease announcements go to `#addon-updates`, while pushes, workflows, pull requests, and issues stay in `#github`. Stable releases include the current WoW version, readable notes, and links to GitHub, CurseForge, Wago, and WoWInterface. Duplicate release events are combined into one announcement, and bot posts do not open discussion threads automatically. Keep Discord FAQ/tag answers that describe MagguuUI aligned with the current MagguuUI version (EllesmereUI companion). Do not leave stale ElvUI-installer wording in those tags.

### 7. Optional admin dashboard

Expose the dashboard through a trusted HTTPS reverse proxy, then configure `DISCORD_CLIENT_SECRET`, a random 32-byte `SESSION_SECRET`, the comma-separated `ADMIN_USER_IDS` allowlist, and the exact public HTTPS origin in `DASHBOARD_BASE_URL` (no path or query). Add `<DASHBOARD_BASE_URL>/auth/callback` as a redirect in the Discord Developer Portal. The secure session cookies intentionally do not work over plain HTTP. Browser requests opened through the local Docker/Unraid URL are therefore redirected to `DASHBOARD_BASE_URL` before OAuth starts. The proxy must preserve `Host` or send `X-Forwarded-Host`, and send `X-Forwarded-Proto: https` for public requests.

A successful dashboard login remains valid for up to 30 days. Keep `SESSION_SECRET` unchanged across container updates; rotating it intentionally signs every device out.

Forwarded client-IP headers (`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`) are trusted only when the TCP peer is listed in `TRUSTED_PROXIES` (IPs/CIDRs of your reverse proxy, e.g. the cloudflared container); empty means the socket IP is used. `TRUST_PROXY` alone no longer trusts anything, so a direct LAN client cannot spoof its rate-limit key. Webhook rate limits: at most 300 unauthenticated requests per minute per client IP (checked before auth; authenticated requests do not count, and a valid `WEBHOOK_SECRET` passes even when that IP is flooding), plus 600 authenticated requests per minute per webhook source after auth. Over-limit requests get HTTP 429. The exact public host/protocol headers above are used only for safe dashboard canonicalization, not as proof of identity or as a client IP.

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
Sonarr / Radarr / Seerr / Tautulli / SABnzbd / Prowlarr / GitHub
   └─POST──► Hono webhook routes ──► embed builder ──► discord.js ──► Discord channel
                     │
                     └──► SQLite activity log (+ webhook retries)

Discord user ──slash cmd──► discord.js ──► service clients ──► *arr / SAB REST API
Discord user ──button──► Seerr approval / tickets / roles ──► REST + SQLite
Admin browser ──OAuth──► Vue dashboard (same origin) ──► /admin API
```

## File layout

```
src/
├── index.ts                     # entry: boot discord + http server
├── config.ts                    # zod-validated env
├── settings.ts                  # runtime feature toggles (SQLite)
├── db/                          # schema + WAL client + backup/restore
├── discord/
│   ├── commands/                # 56 slash commands (see AGENTS.md)
│   ├── interactions/            # Seerr, tickets, roles, suggestions, …
│   ├── server-layout.ts            # STRUCTURE, ROLES, name constants (shared by setup-server + rollout)
│   └── channel-store.ts         # SQLite-first channel ID resolution
├── embeds/                      # EmbedBuilder factories (no posting)
├── server/
│   ├── app.ts                   # Hono + webhook auth + static dashboard
│   ├── admin/                   # dashboard API
│   └── webhooks/                # sonarr, radarr, seerr, tautulli, sabnzbd, prowlarr, github
├── services/                    # *arr / SAB / Seerr / Tautulli / RSS clients
└── utils/
frontend/                        # Vue 3 admin dashboard (Vite → dist-frontend/)
scripts/sabnzbd-webhook.sh
unraid/magguu-bot.xml
.github/workflows/               # ci.yml + docker.yml (+ codeql)
```

Agent rules, channel keys, and command inventory live in `AGENTS.md`.

## Security

- Sonarr, Radarr, Seerr, Tautulli, and SABnzbd require `X-Magguu-Token: <WEBHOOK_SECRET>` (constant-time compare)
- GitHub uses an HMAC signature with `GITHUB_WEBHOOK_SECRET`; Prowlarr requires `Authorization: Bearer <WEBHOOK_SECRET>` (preferred) or the shared secret as `?token=` and should remain internal/LAN-only
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

## Git pre-push hook

Enable the in-repo pre-push checks once per checkout: `git config core.hooksPath .githooks`
