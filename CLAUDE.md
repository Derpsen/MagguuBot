# MagguuBot

Discord bot for the download side of a media homelab. Receives webhooks from **Sonarr / Radarr / Seerr / Tautulli / SABnzbd** and posts styled embeds into dedicated Discord channels. Runs as a single container on Unraid.

Scope is deliberately narrow: **downloads + Plex**, nothing else. No Prowlarr/Bazarr/Uptime/Unraid/generic — if it's not on that list, it's not in this bot.

Install on Unraid via the community-template XML (no docker-compose). Image is published to GHCR by a GitHub Action.

## Stack

Node 24 · TypeScript 5.7 · discord.js 14 · Hono 4 · better-sqlite3 (WAL) · Drizzle 0.36 · Zod · Pino

No ESLint/Prettier. No test framework yet.

## Architecture flow

```
Sonarr / Radarr / Seerr / Tautulli / SABnzbd
   → POST /webhook/{sonarr,radarr,seerr,tautulli,sabnzbd}
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
npm run build        # tsc → dist/
npm run start        # node dist/index.js
npm run typecheck    # tsc --noEmit
npm run db:generate  # drizzle-kit
npm run db:push      # drizzle-kit sync
```

## Verification after changes

1. `npm run typecheck` — strict TS, no errors, no `any`
2. `npm run build` — must succeed, outputs `dist/`
3. Docker changes: locally buildable with `docker build .`; CI publishes to GHCR

## Critical gotchas

**better-sqlite3 on Windows** — needs Python + MSVC. Locally use `npm install --ignore-scripts` to typecheck; for a runnable bot on Windows, use Docker. The Alpine Dockerfile has the build chain.

**Slash commands are per-guild** — registered to `DISCORD_GUILD_ID` on every boot via `REST.put(Routes.applicationGuildCommands)`. Instant update, no 1h global cache. Bot is single-guild by design.

**Webhook auth** — all `/webhook/*` require header `X-Magguu-Token: <WEBHOOK_SECRET>`. Constant-time compare in `server/app.ts`. Don't downgrade to plain `===`.

**Channel IDs are optional** — a webhook without a mapped channel is logged as `skipped` in `webhook_events`, not thrown. First boot ships empty, run `/setup-server`, copy IDs, restart.

**Seerr approval buttons require Administrator** — hardcoded in `interactions/seerr-buttons.ts`. If you open this up to a custom role, also gate the command data via `setDefaultMemberPermissions`.

**discord.js v14 ephemeral** — use `MessageFlags.Ephemeral`, not the deprecated `{ ephemeral: true }`. Every handler uses the flags form.

**Setup-server is idempotent** — checks by name before creating. Safe to re-run. Posts welcome-banner embeds into fresh channels; re-running doesn't re-post.

**Embed limits** — Discord: max 25 fields, field value 1024 chars, description 4096. Use `truncate()` from `embeds/colors.ts`, don't inline slicing.

**SQLite schema is ensured by CREATE TABLE IF NOT EXISTS on boot**. `drizzle-kit push` is available for dev but not required at runtime.

**SABnzbd does NOT emit native webhooks** — use the bash script in `scripts/sabnzbd-webhook.sh` as a post-processing script in SAB. It POSTs to `/webhook/sabnzbd` with a typed Zod payload.

**No cache-control/rate-limit layer** — webhooks are internal (Docker network). Never expose port 3000 publicly without mTLS + rate-limiting + IP allowlist.

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

| Event | Channel env var |
|---|---|
| Sonarr/Radarr Grab | `DISCORD_CHANNEL_GRABS` |
| Sonarr/Radarr Download import, SAB complete | `DISCORD_CHANNEL_IMPORTS` |
| Sonarr/Radarr DownloadFailure/ManualInteraction, SAB failed | `DISCORD_CHANNEL_FAILURES` |
| Seerr MEDIA_PENDING (with Approve/Decline buttons) | `DISCORD_CHANNEL_APPROVALS` (falls back to `REQUESTS`) |
| Seerr approved/declined | `DISCORD_CHANNEL_REQUESTS` |
| Tautulli recently_added | `DISCORD_CHANNEL_NEW_ON_PLEX` |
| Sonarr/Radarr/SAB health + warnings | `DISCORD_CHANNEL_HEALTH` |

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
