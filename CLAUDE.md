# MagguuBot

Discord bot for the download side of a media homelab. Receives webhooks from **Sonarr / Radarr / Seerr / Tautulli / SABnzbd** and posts styled embeds into dedicated Discord channels. Runs as a single container on Unraid.

Scope is deliberately narrow: **downloads + Plex**. Prowlarr health belongs here because dead indexers silently break grabs. No Bazarr/Uptime/Unraid/generic — if it's not on that list, it's not in this bot.

Install on Unraid via the community-template XML (no docker-compose). Image is published to GHCR by a GitHub Action.

## Stack

Node 24 · TypeScript 6 · Vue 3.5 · Vite 8 · discord.js 14 · Hono 4 · better-sqlite3 12 (WAL) · Drizzle 0.45 · Zod 4 · Pino 10

No ESLint/Prettier. Tests use Node's built-in test runner.

## Architecture flow

```
Sonarr / Radarr / Seerr / Tautulli / SABnzbd / Prowlarr
   → POST /webhook/{sonarr,radarr,seerr,tautulli,sabnzbd,prowlarr}
     (X-Magguu-Token header, constant-time compared)
   → embed builder
   → discord.js channel.send()
   → SQLite activity log (webhook_events)

Discord user → slash command → service client → *arr / SAB REST API
Discord user → button → Seerr approve/decline → Seerr REST API
```

## Commands

```bash
npm run dev          # tsx watch
npm run build        # Vite frontend → dist-frontend/, then tsc → dist/
npm run start        # node dist/index.js
npm run typecheck    # backend tsc --noEmit + frontend vue-tsc --noEmit
npm test             # focused regression tests via node:test
npm run check        # typecheck + tests + production build
npm run db:generate  # drizzle-kit
npm run db:push      # drizzle-kit sync
```

## Verification after changes

1. `npm run typecheck` — strict TS, no errors, no `any`
2. `npm run build` — must succeed, outputs `dist/` and `dist-frontend/`
3. Docker changes: locally buildable with `docker build .`; CI publishes to GHCR

## Critical gotchas

**better-sqlite3 on Windows** — needs Python + MSVC. Locally use `npm install --ignore-scripts` to typecheck; for a runnable bot on Windows, use Docker. The Alpine Dockerfile has the build chain.

**Slash commands are per-guild** — registered to `DISCORD_GUILD_ID` on every boot via `REST.put(Routes.applicationGuildCommands)`. Instant update, no 1h global cache. Bot is single-guild by design.

**Webhook auth** — all `/webhook/*` require header `X-Magguu-Token: <WEBHOOK_SECRET>` (constant-time compared in `server/app.ts`), **except**:
- `/webhook/github` — HMAC-SHA256 via `GITHUB_WEBHOOK_SECRET` instead
- `/webhook/maintainerr` — requires `Authorization: Bearer <WEBHOOK_SECRET>` (preferred) or `?token=<WEBHOOK_SECRET>`; keep internal/LAN-only

`/webhook/*` is rate-limited at 120 req/min/IP. Client IP resolved from `cf-connecting-ip` → `x-forwarded-for` → `x-real-ip` → `unknown`. Don't downgrade the token check to plain `===`.

**Webhook retries** — failed Discord deliveries from replay-supported inbound webhooks (Sonarr, Radarr, Seerr, Tautulli, SABnzbd, Maintainerr, GitHub, and Prowlarr) are persisted with retry metadata and replayed by the minute scheduler. Backoff is 1m, 5m, 15m, 1h, then 6h; `WEBHOOK_RETRY_MAX_ATTEMPTS` limits attempts. Replay-generated event rows reference the original event and must not recursively schedule their own retries. RSS and Blue Tracker delivery failures remain unseen and are retried on their next poll.

**Automatic backups** — the hourly scheduler creates at most one `automatic-*.db` SQLite snapshot per local day after `AUTOMATIC_BACKUP_HOUR`. Retention only prunes automatic snapshots and never deletes manual backups.

**Plex activity lifecycle** — movie/episode events correlate by `sessionKey`, falling back to user/player/media identity. Music uses one `music:<user>:<player>` card across tracks and records the current session so late events from the previous track are ignored. Subsequent events edit the card, and watched takes precedence over a later stop. Pause is held for two minutes before the card flips; a resume in that window is dropped. The hourly cleanup deletes tracked Discord cards older than `PLEX_ACTIVITY_RETENTION_DAYS`; zero disables deletion.

**Generic lifecycle cards** — `event_lifecycle_messages` and `postOrEditLifecycleEmbed` keep one Discord card per stable upstream resource. It is used for Seerr issues, GitHub PRs/issues, and typed Sonarr/Radarr health checks. Do not apply it to append-only feeds such as imports, releases, RSS, or audit/mod logs.

**Channel IDs are optional** — a webhook without a mapped channel is logged as `skipped` in `webhook_events`, not thrown. First boot ships empty, run `/setup-server`, copy IDs, restart.

**Seerr approval buttons require Administrator** — hardcoded in `interactions/seerr-buttons.ts`. If you open this up to a custom role, also gate the command data via `setDefaultMemberPermissions`.

**discord.js v14 ephemeral** — use `MessageFlags.Ephemeral`, not the deprecated `{ ephemeral: true }`. Every handler uses the flags form.

**Setup-server is idempotent** — checks by name before creating. Safe to re-run. Posts welcome-banner embeds into fresh channels; re-running doesn't re-post.

**Embed limits** — Discord: max 25 fields, field value 1024 chars, description 4096. Use `truncate()` from `embeds/colors.ts`, don't inline slicing.

**SQLite schema is ensured by CREATE TABLE IF NOT EXISTS on boot**. `drizzle-kit push` is available for dev but not required at runtime.

**SABnzbd does NOT emit native webhooks** — use the bash script in `scripts/sabnzbd-webhook.sh` as a post-processing script in SAB. It POSTs to `/webhook/sabnzbd` with a typed Zod payload.

**Rate limit is intentionally small and in-process** — webhooks are expected to be internal (Docker network). Never expose port 3000 publicly without mTLS + stronger edge rate-limiting + IP allowlist.

## Conventions

- Embed builders return `EmbedBuilder`, never post them — posting is centralized in `server/discord-poster.ts`
- Service clients return `null` (not throw) when the service is not configured; callers decide what to do
- Activity log is append-only — no UPDATE on `webhook_events` except for retries
- Channel-ID env vars: `DISCORD_CHANNEL_*` (ALLCAPS snake_case)
- Colors live in `embeds/colors.ts` — use `Colors.sonarr/radarr/seerr/plex/sabnzbd/...` instead of hex literals
- `formatBytes` / `truncate` / `Colors` are the only embed primitives — everything else is per-domain
- **No `any`** — use `unknown` + narrow with Zod or type guards (strict mode + `noUncheckedIndexedAccess` are on)
- **No comments explaining WHAT** — only WHY, and only when non-obvious

## Channel mapping (event → channel)

Channels are resolved at runtime via `getChannel(key)` from `src/discord/channel-store.ts` (SQLite-first, env fallback). The persistent keys below match the STRUCTURE plan in `/setup-server`.

| Event | Channel key |
|---|---|
| Sonarr/Radarr Grab | `grabs` |
| Sonarr/Radarr Download import, SAB complete | `imports` |
| Sonarr/Radarr DownloadFailure/ImportFailure/ManualInteraction, SAB failed, Seerr ISSUE_* | `fehler` |
| Seerr MEDIA_PENDING (with Approve/Decline buttons) | `freigaben` |
| Seerr approved/declined/available/failed/deleted | `anfragen` |
| Tautulli recently_added / created | `neuAufPlex` |
| Tautulli playback events | `aktivität` |
| Sonarr/Radarr SeriesDelete/MovieDelete/*FileDelete, Maintainerr events | `gelöscht` |
| Sonarr/Radarr/Prowlarr health + warnings + ApplicationUpdate | `health` |
| Member join welcome embed | `welcome` |
| Member join/leave + role changes | `auditLog` |
| Moderation actions (warn/timeout/kick/ban/purge) | `modLog` |
| GitHub events (default) | `github` |
| Stable/prerelease announcements for repos in `ADDON_REPO_FULL_NAMES` | `addonUpdates` (falls back to `github`) |
| WoW Blue-Tracker RSS | `blueTracker` |
| Multi-RSS feeds | per-feed `channel_id` in `rss_feeds` table |
| Starboard (⭐ threshold) | `starboard` |
| Automatic weekly digest | `weeklyDigest` |
| Auto-updating queue card | `downloadLive` |
| Movie-Night voting | `movieNight` |

## Slash commands (51 total, categorized in `/help`)

- **Downloads**: `/queue`, `/arr-status`, `/calendar`, `/plex-top`, `/plex-now-playing`, `/search movie|show`
- **Moderation**: `/warn`, `/timeout`, `/kick`, `/ban`, `/unban`, `/purge`, `/purge-user`, `/slowmode`, `/lockdown`
- **Utility**: `/help`, `/announce`, `/poll`, `/profile`, `/wrapped`, `/movie-night`, `/countdown`, `/remindme`, `/rank`, `/leaderboard`, `/userinfo`, `/serverinfo`, `/avatar`, `/botinfo`, `/tag`, `/rep`, `/suggest`, `/afk`, `/snipe`, `/editsnipe`, `/quote`, `/giveaway`, `/birthday`
- **Admin**: `/setup-server` (dry-run by default; fast incremental apply, optional `full:true` repair), `/cleanup-server`, `/doctor`, `/downloads-live`, `/sticky`, `/db-backup`, `/db-restore`, `/roles-panel`, `/autoresponder`, `/schedule-announce`, `/ticket-panel`, `/suggestion-status`, `/jtc`

## GitHub webhook

`/webhook/github` accepts GitHub's native payload. Signature is HMAC-SHA256 verified with `GITHUB_WEBHOOK_SECRET` (shared with each repo's Settings → Webhooks → Secret). Events handled: `push`, `workflow_run` (only on `completed`, and never `success`/`skipped`), `release` (`published`/`released`), `pull_request` (`opened`/`closed`/`reopened`/`ready_for_review`), `issues` (`opened`/`closed`/`reopened`), and `ping`. Anything else is logged + ignored.

Per-repo routing: `ADDON_REPO_FULL_NAMES` defaults to `Derpsen/MagguuUI`. Only release announcements for those repos go to `addonUpdates`; pushes, workflows, pull requests, and issues stay in the technical `github` channel. Release announcements are deduplicated by repository and tag because GitHub can deliver both `published` and `released` for one release. Bot posts must not create discussion threads automatically.

## Discord intents

`Guilds` + `GuildMembers` (privileged — must be enabled in Dev Portal) + `GuildMessages` + `GuildMessageReactions` + `GuildVoiceStates` + `MessageContent` (privileged — required for autoresponders; must be enabled in Dev Portal). Partials: `Message`, `Channel`, `Reaction` (for starboard on pre-cache messages). `GuildPresences` is deliberately off.

## References

- Env vars: `.env.example`
- Schema: `src/db/schema.ts`
- Webhook routes: `src/server/webhooks/`
- Service clients: `src/services/`
- Slash commands: `src/discord/commands/`
- SAB script: `scripts/sabnzbd-webhook.sh`
- Unraid template: `unraid/magguu-bot.xml`

## What NOT to do

- NEVER commit `.env`, `.env.*` (except `.env.example`), `data/`, or `dist/` — gitignored
- NEVER skip the shared-secret middleware — `/webhook/*` routes are unauthenticated without it
- NEVER register global slash commands — per-guild only (1h Discord cache otherwise)
- NEVER post embeds directly from route handlers — always through `postEmbed()` so everything gets logged
- NEVER add `any` — use `unknown` + narrow with Zod or type guards
- NEVER expose port 3000 to the public internet — internal Docker network only
