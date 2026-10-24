# Changelog

All notable MagguuBot changes. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Security
- `/ban`, `/kick`, `/timeout` enforce role hierarchy (invoker's highest role above the target's, guild owner exempt), reject self/bot/owner targets and keep the bot-side check, with German ephemeral errors.
- `/announce`, `/schedule-announce`, `/purge-user` check the invoker's permissions in the target channel(s); `/announce ping-role` requires a mentionable role or `Mention @everyone` in that channel.
- `/warn` auto-escalation (1h timeout and kick) uses the same role-hierarchy guard; the warning is still recorded, a denied escalation is skipped and the moderator is told why (ephemeral, German).
- Webhook rate limit split: pre-auth flood limit (300 unauthenticated req/min per IP, authenticated requests refunded/bypass) plus a per-webhook limit after auth (600 req/min per route source + credential hash; raw token never logged). An unauthenticated flood no longer throttles real *arr/GitHub webhooks.
- Webhook rate-limit client IP: forwarded headers are only trusted from peers listed in the new `TRUSTED_PROXIES` (IP/CIDR allowlist, X-Forwarded-For walked right-to-left). `TRUST_PROXY=true` alone no longer trusts headers (startup warning).

### Added
- `/erinnerung an|liste|aus|fortsetzen`: user-defined Raid / Mythic+ / misc reminders (weekday + time in `TIME_ZONE`, optional text ≤100 chars, one-off or weekly, DM or channel with only the subscriber mentioned). SQLite table `raid_reminders` (migration via `CREATE TABLE IF NOT EXISTS`), 30 s scheduler tick, DST-safe next-run calculation, max 5 per user, only reminders ≤15 min overdue are sent after a restart, DM error 50007 pauses the subscription instead of alarming (`/erinnerung fortsetzen` resumes), `allowedMentions` strict.
- CI failure alarm: reusable workflow `.github/workflows/ci-alarm.yml`, called by `ci`, `docker` and `quality` (push to main, `failure()` only) posts repository, workflow, SHA, run URL and the last ~20 redacted log lines as JSON to the repo secret `ESCALATION_WEBHOOK_URL` with `Authorization: Bearer $ESCALATION_BEARER`. Skips quietly when a secret is empty, never turns a run red (continue-on-error, 10 s curl timeout), one alarm per run, none for re-runs, `Idempotency-Key` = sha256(repo|workflow|sha).
- `/neu [tage 1-30] [typ]`: new Plex movies/series of the last days from Tautulli `get_recently_added`, paginated ephemeral embed with page buttons (invoker only), 5 min cache, 5 s per-user cooldown, friendly error text instead of alarms. Posters only from public TMDB/TVDB URLs of an already configured Radarr/Sonarr library, never Plex token URLs.
- Plex weekly statistics card: one embed (top movies/series, most active users, plays, watch hours of the last 7 days from Tautulli) in `#neu-auf-plex`, edited in place (message id in SQLite `plex_weekly_card`, content-hash dedupe, repost only if the message is gone). Weekly schedule via `PLEX_WEEKLY_ENABLED/DAY/HOUR` (default Monday 08:00, `TIME_ZONE`), channel override `DISCORD_CHANNEL_PLEX_WEEKLY`, manual refresh with `/wochenstatistik`. Tautulli errors are logged quietly, no Discord alarm.

### Fixed
- Review follow-ups: CI alarm redaction now also replaces bare tokens (`ghp_`/`gho_`/`ghs_`/`github_pat_`), JWTs, URLs, bearer values and 32+ char hex/base64 strings inline (test runs the real function with fake values); `/neu` caches a failed Tautulli fetch for 45 s (no upstream request per click) and page buttons have a 1.5 s per-user cooldown; every logged `err` goes through a scrubbing serializer (apikey/token query values, URL credentials, sensitive keys, registered literal secrets, `cause` chain/stack) and the Tautulli key is registered as a literal secret; when edits keep failing and the Plex activity card is reposted, the old tracked message is deleted best-effort (one call, errors ignored, never a bulk delete).
- Plex weekly card hardening: permanent Discord errors (10003/50001/50013) pause the card for 30 min with a single warn log instead of retrying every tick, titles/user names are clipped (48) and markdown/mention-escaped, `/wochenstatistik` refuses DMs and missing Manage Server at runtime (tested).
- Plex card hardening: failed edits count once per real Discord attempt (exponential backoff instead of timer + 30 s tick double counting, repost only after 5 real failures), permanent errors 10003/50001/50013 pause the card for 30 min instead of retrying every 30 s, webhook user/player/title are clipped (40/40/150) and markdown/mentions escaped.
- Plex activity channel flood: playback events no longer post a card each. One card in `🎬・plex-aktivität` lists running sessions and the last finished ones and is edited in place (message id persisted in SQLite, debounced, skipped when unchanged, reposted only when the message is gone or edits keep failing). Discord-format Tautulli events are correlated by user + player instead of the notification text.
- Discord Seerr Approve/Decline failed with HTTP 403 because MagguuBot used a stale Seerr API key. Doctor and service health now probe `/api/v1/request/count` (authenticated) instead of the public `/status` endpoint.

### Changed
- MagguuUI FAQ/install embeds synced to current MagguuUI: skip Ellesmere start popup, Window & Tooltip Skins precheck, Edit Mode MagguuUI once, scale 0.58 from Magguu-Profile übernehmen / Magguu Settings, full WowUp starter + optional packs, 11 client locales, Skinning NAMEN & FARBEN DualRow (unit/party-raid + class keybinds, no EXBoss split), Load profiles activate-only except class layouts (no KeystoneLoot), QoL Itemlevel, Hide Services on General, Boiling Point, Targeted Spell Bars ON / EXBoss MythicCast OFF, AuraBuff-Count centered. In-game gold button is Magguu-Profile übernehmen (not “Install All”). Setup-Buttons BigWigs/NSRT/EXBoss/Smart Reminders; Dump-Addons (WIM, Waypoint, HandyNotes, TTT, GTFO, BugSack, PGF) über Magguu-Profile übernehmen / Profile laden.

## 2026-08-23

### Fixed
- **#55** Channel docs vs code: CLAUDE channel keys (`failures` / `approvals` / `requests` / ...), Health topic SAB→Prowlarr, setup creates Tickets + `ticket-logs`, cleanup protects tickets & Join-to-Create voice.
- **#56** Persist `ticketLogs` channel id when auto-creating `ticket-logs`.
- **#54** CodeQL `init` + `analyze` aligned on v4.37.7.

### Changed
- **#57** FAQ embed links to MagguuUI GitHub Issues.
- **#53** AGENTS.md + refreshed agent/FAQ rule docs.
- **#52** MagguuUI FAQ embeds synced to v12.1.0.
- **#55** README aligned with Discord-only bot + built-in Vue dashboard.

### Notes
- Discord-only (no Telegram). JTC stays via `/jtc`, not `/setup-server`.
- Unraid template optional envs: Homelab scope.
