# AGENTS.md

Discord bot for the download side of a media homelab. Receives webhooks from **Sonarr / Radarr / Seerr / Tautulli / SABnzbd** and posts styled embeds into dedicated Discord channels. Runs as a single container on Unraid.

Scope is deliberately narrow: **downloads + Plex**. Prowlarr health belongs here because dead indexers silently break grabs. No Bazarr/Uptime/Unraid/generic — if it's not on that list, it's not in this bot.

Install on Unraid via the community-template XML (no docker-compose). Image is published to GHCR by a GitHub Action.

Human install docs live in `README.md`. This file is the agent entrypoint (stack, architecture, gotchas, channel map, slash inventory, MagguuUI FAQ, Grok Bot / Buddy, CI).


## Live ops baseline (2026-10-06)

- **Live Bot image:** auto-deployed (`magguu-pull` after every green App-Image Docker publish). The running build SHA/date is shown by `/status` (Discord) and `GET /api/status` (Bearer `STATUS_API_TOKEN`). Do not write a live `sha-…` tag or digest here; deploy history lives in `MEMORY.md`.
- Wave: #97 (pino) + #98 (@lucide/vue); "Unraid & Server" already on that digest.
- Discord `/setup-server full` Done - FAQ/welcome embeds = **Whisper Messenger**, nicht WIM / Ellesmere WIM Skin.
- Pack-/Author-HARD: Magguu/MagguuUI only in Magguu copy; foreign authors untouched; Optional = Whisper Messenger.
- Prefer **Done-Wave Capture** after App-Image waves; keine neuen Specialist-Bots.

## Safe Working Rules

- Read this file (and the touched module) before changing behavior.
- Keep changes small and focused. Do not publish unrelated dirty WIP.
- Never commit `.env`, secrets, `data/`, or `dist/`.
- Never expose webhook port 3000 publicly; never skip shared-secret auth.
- MagguuUI FAQ/tag answers that describe the addon must stay in sync with
  current MagguuUI releases/versions.

## Stack

Node 26 · TypeScript 6 · Vue 3.5 · Vite 8 · discord.js 14 · Hono 4 · better-sqlite3 13 (WAL) · Drizzle 0.45 · Zod 4 · Pino 10

Overrides: `esbuild` **0.28.2**, `undici` **6.29.1** (discord.js, @discordjs/rest) / **7.30.1** (cheerio), `source-map-js` **1.2.2**, `fast-copy` **4.1.2** (dev, via `pino-pretty`). Do not jump TypeScript 7 or `@types/node` 26 (Node 26 is live since 2026-10-16).

As of 2026-10-14: addon live **v12.1.8**; container runs as **uid 99**; images are **Cosign keyless** signed; **WIM is removed** (Whisper Messenger is the whisper chat); `engines.node >=26`, Node 26 live (approved 2026-10-16).

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
2. `npm test` — node:test regressions
3. `npm run build` — must succeed, outputs `dist/` and `dist-frontend/`
4. Docker changes: locally buildable with `docker build .`; CI publishes to GHCR

## Critical gotchas

**better-sqlite3 on Windows** — needs Python + MSVC. Locally use `npm install --ignore-scripts` to typecheck; for a runnable bot on Windows, use Docker. The Alpine Dockerfile has the build chain.

**Slash commands are per-guild** — `REST.put(Routes.applicationGuildCommands)` to `DISCORD_GUILD_ID`. Instant update, no 1h global cache. Body hash is stored in `feature_state` (`slash_commands_hash`); unchanged boots skip the PUT. Bot is single-guild by design.

**Webhook auth** — all `/webhook/*` require header `X-Magguu-Token: <WEBHOOK_SECRET>` (constant-time compared in `server/app.ts`), **except**:
- `/webhook/github` — HMAC-SHA256 via `GITHUB_WEBHOOK_SECRET` instead
- `/webhook/prowlarr` — requires `Authorization: Bearer <WEBHOOK_SECRET>` (preferred) or `?token=<WEBHOOK_SECRET>`; Prowlarr has no custom-header field so it uses the query token; keep internal/LAN-only

`/webhook/*` is rate-limited at 120 req/min/IP. Client IP resolved from `cf-connecting-ip` → `x-forwarded-for` → `x-real-ip` → `unknown`. Don't downgrade the token check to plain `===`.

**Webhook retries** — failed Discord deliveries from replay-supported inbound webhooks (Sonarr, Radarr, Seerr, Tautulli, SABnzbd, GitHub, and Prowlarr) are persisted with retry metadata and replayed by the minute scheduler. Backoff is 1m, 5m, 15m, 1h, then 6h; `WEBHOOK_RETRY_MAX_ATTEMPTS` limits attempts. Replay-generated event rows reference the original event and must not recursively schedule their own retries. RSS and Blue Tracker delivery failures remain unseen and are retried on their next poll.

**Automatic backups** — the hourly scheduler creates at most one `automatic-*.db` SQLite snapshot per local day after `AUTOMATIC_BACKUP_HOUR`. Retention only prunes automatic snapshots and never deletes manual backups.

**Plex activity lifecycle** — movie/episode events correlate by `sessionKey`, falling back to user/player/media identity. Music uses one `music:<user>:<player>` card across tracks and records the current session so late events from the previous track are ignored. Subsequent events edit the card, and watched takes precedence over a later stop. Pause is held for two minutes before the card flips; a resume in that window is dropped. The hourly cleanup deletes tracked Discord cards older than `PLEX_ACTIVITY_RETENTION_DAYS`; zero disables deletion. Every minute the stale-session tick terminates Tautulli sessions paused or stuck for `PLEX_STALE_SESSION_MINUTES` (default 20, `0` disables) and flips orphan play/pause cards to stopped when Tautulli no longer has a matching live session.

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

Channels are resolved at runtime via `getChannel(key)` from `src/discord/channel-store.ts` (SQLite-first, env fallback, process-local Map; `saveChannel` invalidates). The persistent keys below match `STRUCTURE` in `src/discord/server-layout.ts` (several keys share one channel; `refs` on each channel plan is the mapping). `pino-pretty` is a **devDependency** (prod logger is JSON).

| Event | Channel key → channel |
|---|---|
| Sonarr/Radarr Grab | `grabs` → `📡・downloads` |
| Sonarr/Radarr Download import, SAB complete | `imports` → `📡・downloads` |
| Sonarr/Radarr DownloadFailure/ImportFailure/ManualInteraction, SAB failed, Seerr ISSUE_* | `failures` → `🩺・status` |
| Seerr MEDIA_PENDING (with Approve/Decline buttons) | `approvals` → `⏳・freigaben` |
| Seerr approved/declined/available/failed/deleted | `requests` → `📝・anfragen` |
| Tautulli recently_added / created | `newOnPlex` → `✨・neu-auf-plex` |
| Tautulli playback events | `plexActivity` → `📡・downloads` |
| Sonarr/Radarr SeriesDelete/MovieDelete/*FileDelete | `health` → `🩺・status` |
| Sonarr/Radarr/Prowlarr health + warnings + ApplicationUpdate | `health` → `🩺・status` |
| Member join welcome embed | `welcome` → `👋・willkommen` |
| Member join/leave + role changes | `auditLog` → `📋・logs` |
| Moderation actions (warn/timeout/kick/ban/purge) | `modLog` → `📋・logs` |
| GitHub events (default) | `github` → `🩺・status` |
| Stable/prerelease announcements for repos in `ADDON_REPO_FULL_NAMES` | `addonUpdates` → `📰・updates` (falls back to `github`) |
| MagguuUI FAQ channel (tag answers) | `faq` → `❓・hilfe` |
| Community suggestions (`/suggest`) | `suggestions` → `💡・vorschläge` |
| Ticket close + transcripts | `ticketLogs` → `📋・logs` (name fallback `TICKET_LOG_CHANNEL_NAME`) |
| WoW Blue-Tracker RSS | `blueTracker` → `📰・updates` |
| Multi-RSS feeds | per-feed `channel_id` in `rss_feeds` table |
| Starboard (⭐ threshold) | `starboard` → `🎬・movie-night` |
| Automatic weekly digest | `weeklyDigest` → `✨・neu-auf-plex` |
| Auto-updating queue card | `downloadLive` → `📡・downloads` |
| Movie-Night voting | `movieNight` → `🎬・movie-night` |

## Server layout & rollout

- Layout (5 categories, 15 channels, 11 roles) lives in `src/discord/server-layout.ts`: `STRUCTURE`, `ROLES` (with `oldNames` = rename/reuse, `mergeFrom` = member migration), name constants (`CHANNEL`, `ROLE`, `TICKET_LOG_CHANNEL_NAME`, `TICKET_CATEGORY_NAME`, `JTC_*`, `ARCHIVE_CATEGORY_NAME` = `🗄️ ARCHIV`) and the single role-button set `PING_ROLE_BUTTONS`.
- Planning is pure (`src/rollout/plan.ts`, tests in `tests/discord-rollout.test.ts`); `/setup-server`, `/cleanup-server` and the CLI share it. Ping/role lookups go through `findLayoutRole` so legacy names (`ping-4k`, `ping-github`, …) keep working until the rename.
- `/setup-server` renames/reuses, moves foreign channels to `🗄️ ARCHIV`, hides empty legacy categories, re-points bot keys and sets `autoRoleId` to the real Newcomer id. It **never deletes** channels or roles. `/cleanup-server` only archives. Nothing deletes layout channels/roles on startup (only JTC personal rooms and closed tickets are deleted by their features).
- One-shot CLI inside the container: `node dist/rollout/discord-rollout.js` (`--dry-run` default, `--apply`; also enables Community, onboarding and welcome screen, migrates members of merged roles). Deletion is separate: `--delete-archived` plus env `DELETE_APPROVED=yes`, only channels in `🗄️ ARCHIV` without open bot cards/DB references, empty legacy categories and empty non-layout roles. `--apply` takes a DB snapshot first and aborts on pending webhook retries. After `--apply` restart the container (channel cache is per process).
- Bot role sits below Admin/Moderator live, so their permission edits are reported as manual steps.
- Embeds: one accent `BRAND_COLOR` #0CD29D (only `warn` #F59E0B and `danger` #EF4444 differ); bot footer icon is the Website logo (`WEBSITE_LOGO_URL`). Stats voice counters are gone.

## Slash commands (52 total, categorized in `/help`)

- **Downloads**: `/queue`, `/arr-status`, `/calendar`, `/plex-top`, `/plex-now-playing`, `/search movie|show`
- **Moderation**: `/warn`, `/timeout`, `/kick`, `/ban`, `/unban`, `/purge`, `/purge-user`, `/slowmode`, `/lockdown`
- **Utility**: `/help`, `/announce`, `/poll`, `/profile`, `/wrapped`, `/movie-night`, `/countdown`, `/remindme`, `/rank`, `/leaderboard`, `/userinfo`, `/serverinfo`, `/avatar`, `/botinfo`, `/status`, `/tag`, `/rep`, `/suggest`, `/afk`, `/snipe`, `/editsnipe`, `/quote`, `/giveaway`, `/birthday`
- **Admin**: `/setup-server` (dry-run by default; renames/archives, never deletes; `full:true` re-renders all pinned panels), `/cleanup-server` (archive only), `/doctor`, `/downloads-live`, `/sticky`, `/db-backup`, `/db-restore`, `/roles-panel`, `/autoresponder`, `/schedule-announce`, `/ticket-panel`, `/suggestion-status`, `/jtc`

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


## MagguuUI FAQ / release sync

- MagguuUI stable/prerelease announcements route via `ADDON_REPO_FULL_NAMES`
  (default `Derpsen/MagguuUI`) to `addonUpdates`.
- Host: EllesmereUI TOC min **9.0.6+** (live **9.2.9**); Magguu bake is
  **dump-based** (Magguu multi-export, dump values win); release notes
  reference **v12.1.8** (latest MagguuUI tag).
- Discord FAQ/tag content that describes MagguuUI must stay aligned with the
  current MagguuUI version and install story (EllesmereUI 9.0.6+ companion;
  four sibling AddOns folders MagguuUI / MagguuUI_Data / MagguuUI_EUI /
  MagguuUI_Media, all enabled; skip Ellesmere start popup; Window & Tooltip
  Skins precheck; Edit Mode MagguuUI once; scale 0.58 from Magguu-Profile
  übernehmen / Magguu Settings; gold **Magguu-Profile übernehmen** then
  Magguu Settings + companions; **Magguu Settings** = overlay/QoL only; **Load
  profiles** activate-only except class layouts — Settings/Load do not re-import;
  Targeted Spell Bars ON via Magguu-Profile
  übernehmen, EXBoss MythicCast OFF; Boiling Point kept; TopBar / Hearth /
  Magguu FPS removed;
  AuraBuff count CENTER; Magguu does not join/leave/hide Services; Skinning
  NAMES & COLORS DualRow (unit-frame | party/raid; class keybinds — do not
  restore EXBoss split); Setup buttons BigWigs / Northern Sky / EXBoss / Smart
  Reminders / Whisper Messenger; WowUp optional pack includes Whisper
  Messenger, HandyNotes MapNotes, Premade Groups Filter, Auctionator, and Smart
  Reminders — no WIM / Ellesmere WIM Skin in the pack). Player-facing FAQ never says bake, dump,
  or recapture. Do not leave stale ElvUI-installer, Ashvane, TopBar/FPS,
  or one-folder wording in FAQ tags. Do not restore MagguuKSL.
- Bot copy/docs: person names only Magguu / MagguuUI; scrub foreign
  author/person credits; keep addon product names; never set Magguu as
  author of a foreign addon. FAQ embeds must not name foreign authors.
- Public tone: factual Magguu voice. Public contact is **contact@magguu.xyz**
  (no personal addresses in bot copy).
- CurseForge / Wago / WoWI paste files live in MagguuUI
  `docs/store-descriptions/` (not this repo). Discord FAQ is separate and
  still needs `/setup-server` **full** to refresh live SQLite.

## WowUp packs (2026-10-06)

- **Starter:** EllesmereUI, MagguuUI, BigWigs, LittleWigs, Northern Sky, EXBoss, EXCore.
- **Optional:** BugGrabber, BugSack, HandyNotes, HandyNotes MapNotes, MDT, Raider.IO, Simulationcraft, Talent Tree Tweaks, Whisper Messenger (WhisperMessenger), Waypoint UI, GTFO, Premade Groups Filter, Auctionator, Smart Reminders.
- **Whisper Messenger** is the whisper addon (Setup button). WIM and Ellesmere WIM Skin are retired. Do not list them or import WIM.
- No WindTools. HandyNotes MapNotes is on WowUp Optional; Magguu settings apply with HandyNotes via Magguu-Profile übernehmen / Profile laden. No KeystoneLoot / Archon-BiS / KSL-BiS in user-facing copy or Optional pack; never MagguuKSL; never name Devourer as a special include.

## Grok Bot / Buddy + Git publish

## Arbeitscomputer (2026-10-15)

- Checkout: Unraid-VM `Ubuntu`, machineId `3ff4cee8-7e7c-4cc9-a262-ebf10016d570`, path `~/Projekte/MagguuBot` (repos ready).
- Marcos PC (`f01cf815-a384-40fb-ac18-c8450b4d5889` / DESKTOP-MA0R4G0) only for WoW AddOns deploy; may be offline.
- Report only to Buddy; never 1:1 Marco (except Auto-review cards with no text).


Marco uses Grok Bot “Buddy” as the single front door. Helpers report back to Buddy.

- Interactive/ad-hoc sessions: do not commit, push, or create git tags unless
  the user explicitly asks for that exact publish step.
- Grok Bot helpers under Buddy's hub standing order: for clear in-scope
  bug/tasks, may commit, push, and merge to main without a per-change ask;
  never force-push; never publish unrelated dirty WIP; report results to Buddy.
- Tags and releases still need an explicit release ask.

## Grok Bot helpers and rooms (2026-10-12)

"Bot & Dashboard" owns this repo and Magguu-Dashboard. "Website" owns MagguuUI-Website only; "Addon (Lua)" owns the addon Lua; "Code-Review" reviews; "Release" releases (Tag-Gate); "Unraid & Server" does Unraid; Buddy is the front door. IDs did not change. Old names: Stack Fixer, Bot Fixer, Addon Fixer, Reviewer, Release Helfer, Homelab Helfer, Projects Manager.

## CI / merge (Grok Bot helpers)

- CodeQL: `github/codeql-action/init` and `analyze` in `.github/workflows/codeql.yml` must share one commit SHA. After a dependency-bot bump (Renovate; formerly Dependabot) of only one pin, merge the matching `init` or `analyze` PR before calling main green.
- Normal work: commit and push directly to `main` from this checkout (no PR, no force-push). Only dependency-bot PRs (Renovate) are merged: locally with `gh pr merge --squash --delete-branch` (the GitHub connector Auto-review blocks MagguuBot merges).
- Never launch Cursor cloud agents for dependency-bot PRs (Renovate/Dependabot), merges, or MagguuBot/Website polyfill work. Never ask Marco; report only to Buddy.


## Discord Admin-Smoke (helpers -> Buddy)

MagguuBot admin is Discord-OAuth gated. If session unavailable -> **BLOCK** with reason (OAuth/session); do not invent success. Pipeline: push to `main`, Buddy reviews commits afterwards; after green App-Image Docker publish, "Unraid & Server" pulls; "Bot & Dashboard" merge report must say **Actions-only** vs **App-Image**.

Paste template for Buddy:

```
Discord-Admin-Smoke: OK | BLOCK
- Login/session: ...
- Routes/pages checked: ...
- Fail: ... (or none)
- Live: bot.magguu.xyz / Unraid MagguuBot
```

When WowUp/copy MagguuUI product facts change, update Bot `AGENTS.md` / `MEMORY.md` together with Website + Magguu-Dashboard the same round.
Nach App-Image-Wellen: Prefer **Done-Wave Capture** (Buddy); skip "Unraid & Server" recreate if live already on handoff digest; keine neuen Specialist-Bots.

## What NOT to do

- NEVER commit `.env`, `.env.*` (except `.env.example`), `data/`, or `dist/` — gitignored
- NEVER skip the shared-secret middleware — `/webhook/*` routes are unauthenticated without it
- NEVER register global slash commands — per-guild only (1h Discord cache otherwise)
- NEVER post embeds directly from route handlers — always through `postEmbed()` so everything gets logged
- NEVER add `any` — use `unknown` + narrow with Zod or type guards
- NEVER expose port 3000 to the public internet — internal Docker network only

## 2026-10-12 Docs/Bots-Sync

- Helpers (renamed again 2026-10-16, IDs unchanged): "Website" = MagguuUI-Website only; "Bot & Dashboard" = MagguuBot + Magguu-Dashboard; "Addon (Lua)" = addon Lua; "Code-Review" = review on request; "Release" = releases/Tag-Gate; "Unraid & Server" = Unraid; Buddy = front door. Former names: Webcraft, Botsmith, Luaforge, Sentinel, Launchpad, Homebase. Captain and all group chats/rooms were deleted 2026-10-16; Buddy contacts helpers directly; Notion holds only rules and the daily Docs-Abgleich log.
- Buddy makes small MagguuUI-Website design/text changes directly; bigger work goes to the helpers. Since 2026-10-12 helpers and Buddy push directly to `main` (no PRs, no pre-review); Buddy reviews commits afterwards; after a green Docker publish the no-AI Unraid pull/test script (`magguu-pull`, rollback on failure) pulls the new image.
- Addon live v12.1.8. "Split names" options are becoming "Two-tone unit-frame names" / "Two-tone party and raid names" (MagguuUI PR #30; `SPLIT_NAMES` keys unchanged): half the name in the default color, half in the class color.
- Website live build: auto-deployed, current SHA at https://ui.magguu.xyz/api/health (history in `MEMORY.md`); legal notice = "free, non-commercial project operated from Switzerland" + `contact@magguu.xyz` (no name, no address).
- Unchanged: WIM removed, Whisper Messenger used; "Apply Magguu profiles"; Node 26 live; locked TS 7, h3 2, @types/node 26; uid 99 + Cosign; `engines.node >=26`; no tags without Marco's yes; never remove third-party author names.

## 2026-10-14 "Bot & Dashboard" wave

- `/status` (utility, ephemeral): uptime, image version from `MAGGUU_BUILD_SHA`/`MAGGUU_BUILD_DATE` (Dockerfile ENV from `VCS_REF`/`BUILD_DATE` build-args, set in `docker.yml` to `github.sha` + OCI created; falls back to "unbekannt"), last webhook per source (Sonarr, Radarr, Seerr, Tautulli, SABnzbd, Prowlarr, GitHub) via `MAX(created_at)` on `webhook_events` (no new table; replay rows excluded). Warning when silent > `STATUS_STALE_HOURS` (default 24). Builder in `src/embeds/status.ts`, tests in `tests/status.test.ts`.
- CI: `ci.yml` runs Node 26 only (full `npm ci` + better-sqlite3/@napi-rs/canvas smoke); docker.yml + version-check.yml use Node 26.
- `scripts/check-versions.mjs` + `version-check.yml` (daily + dispatch): truth = latest MagguuUI release tag (TOC `## Version` is `@project-version@`); Bot mismatches fail, Website mismatches only warn. MagguuUI is private: needs secret `MAGGUUUI_READ_TOKEN`, otherwise the job only warns.
- Helper rename finished (2026-10-14 names; renamed again 2026-10-16); pipeline push-to-main, Buddy reviews afterwards, "Unraid & Server" pulls after green Docker publish.

## 2026-10-14 "Bot & Dashboard" wave 2

- **MagguuUI release poller** (`src/discord/addon-release-poller.ts`): polls `releases/latest` of `MAGGUUUI_RELEASE_REPO` (default Derpsen/MagguuUI, private) every `ADDON_RELEASE_POLL_MINUTES` (15) with `MAGGUUUI_READ_TOKEN`; off without token. Posts to `addonUpdates` (fallback `github`). Announced tags persist in `bot_settings` key `addonReleaseAnnouncedTags`; empty store = seed with current latest (no historical post). Shared with the GitHub release webhook, so poll + webhook never double-post. Drafts/prereleases skipped. Never creates tags.
- Release embed (`src/embeds/addon-release.ts`): deterministic summary of the newest version block of the release body, markdown stripped, headings Große Neuerungen / Weitere Features / Bugfixes, top 3 bullets each (+ "… und N weitere"), link to the full release; field ≤1024, description ≤4096.
- **Website FAQ auto-answer** (`src/discord/faq-autoanswer.ts`, matcher `src/utils/faq-matcher.ts`): source `GET https://ui.magguu.xyz/api/v1/faqs` (public, grouped by category), hourly cache. Only in `FAQ_AUTOANSWER_CHANNEL_IDS` (empty = off), only question-like messages, conservative token-overlap score (`FAQ_AUTOANSWER_MIN_SCORE` 0.6, ≥2 shared tokens, clear lead over runner-up), per-user 300 s / per-channel 60 s cooldowns, same FAQ not repeated per channel within 360 min; otherwise silent. MessageContent intent is already requested in code (`client.ts`); must stay enabled in the Developer Portal.
- `GET /api/status` (read-only JSON: uptime, build SHA/date, last webhook per source; no secrets) – disabled unless `STATUS_API_TOKEN` is set, then requires `Authorization: Bearer`. Used by the Magguu-Dashboard „Magguu-Dienste“ view.
- Renovate replaces Dependabot (`renovate.json`, `.github/dependabot.yml` removed; @types/node <25, TS <7, h3 <2, satori ~0.41 guard in this repo's `renovate.json`, left as is). Website uses satori ^0.47.1; satori >=0.48 is locked without Marco's yes. Renovate GitHub App installed 2026-10-16 (Dependency Dashboard #111). `dependabot-auto-merge.yml` removed 2026-10-16: Renovate is the only updater (also handles vulnerability alerts).
- "Unraid & Server": add to the Unraid template `MAGGUUUI_READ_TOKEN` (masked), `STATUS_API_TOKEN` (masked), `FAQ_AUTOANSWER_CHANNEL_IDS`; optional `ADDON_RELEASE_POLL_MINUTES`.

## Renovate automerge & pre-push hook (2026-10-16)

- `renovate.json`: minor/patch/pin/digest automerge with `automergeType: "branch"` + `platformAutomerge` (lands directly on `main` only after required status checks / CI are green; `ignoreTests: false`). Majors never automerge. Locked majors stay blocked via `allowedVersions`: TypeScript <7, @types/node <25 (stricter than <26).
- In-repo pre-push hook `.githooks/pre-push` runs `npm run typecheck` + `npm test` (no lint script; no ESLint by design) plus `actionlint` (.github/workflows) and `shellcheck` (tracked `*.sh`); missing tools only warn and skip. Enable once per checkout: `git config core.hooksPath .githooks` (set on the Ubuntu VM checkout).
- docker.yml (2026-10-16): `push` to main has a `paths` allowlist (Dockerfile, .dockerignore, docker-entrypoint.sh, package*.json, tsconfig/vite/tailwind/postcss/drizzle configs, `src/**`, `frontend/**`, docker.yml itself). Docs/.githooks/renovate.json/tests-only pushes publish no image. Tags and workflow_dispatch always build. Safe because main has no required status checks; if docker ever becomes a required check, switch to a job-level skip that reports success. Extend the list when the Dockerfile COPYs new files.
- Node 26 live (2026-10-16, Marco approved): engines `>=26`, Dockerfile `node:26-alpine` digest-pinned, all workflows Node 26, Renovate Node hold removed. TS 7 and @types/node 26 stay locked.
- Security (2026-10-16): `scorecard.yml` (ossf/scorecard-action v2.5.0, SHA-pinned; push main + weekly; SARIF → code scanning, upload-sarif SHA = codeql.yml SHA, bump together) and `dependency-review.yml` (actions/dependency-review-action v5.0.0, PRs, fails on >= moderate). Secret scanning + push protection enabled via `gh api` (verified enabled).
- Quality (2026-10-16): `.github/workflows/quality.yml` runs `tools/drift-check.sh` (banned addon names outside AGENTS/MEMORY/CHANGELOG/tests, EllesmereUI min 9.0.6 in TOCs, Docker uid 99, engines.node = `${NODE_ENGINE:->=26}`), actionlint 1.7.12 + zizmor 1.31.1 (medium+) + shellcheck + osv-scanner 2.7.0 (downloads sha256-verified). All workflows hardened for zizmor: checkout `persist-credentials: false`, docker.yml packages:write only on build job and no npm cache (package-manager-cache: false).

## Docs drift (2026-10-22)

- `tools/docs-drift.sh` (generic, copied 1:1 from MagguuUI-Website; keep identical across repos) reads `.github/docs-drift-rules.txt` (`regex<TAB>reason[<TAB>allow[<TAB>file-scope]]`, `@files`, `@allow`, `@ignorecase`, `@health-url`) and prints `file:line: reason`; exit 1 on hits. Rules flag old helper names (written in history lines with "formerly"/"Old names"/dated prefix are allowed), Captain, the banned whisper addon (written as `[W]IM` in the rules), the old PR/pre-review flow, Dependabot as active updater, Node 26 as locked, locked majors (TypeScript 7, h3 2, js-yaml 5, `@types/node` 26) presented as done, and any live `sha-…`/`sha256:` in AGENTS.md (history belongs in MEMORY.md). No `@health-url`: `GET /api/status` is Bearer-gated (off without `STATUS_API_TOKEN`) and no public health URL is documented; the live build SHA is visible via `/status` / `/api/status`.
- `.github/workflows/docs-drift.yml` (Mon 05:17 UTC + dispatch) opens/updates one issue "Docs-Drift" assigned to Derpsen, and closes it when clean. Run locally: `bash tools/docs-drift.sh`.
