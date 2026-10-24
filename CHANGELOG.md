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
- `/neu [tage 1-30] [typ]`: new Plex movies/series of the last days from Tautulli `get_recently_added`, paginated ephemeral embed with page buttons (invoker only), 5 min cache, 5 s per-user cooldown, friendly error text instead of alarms. Posters only from public TMDB/TVDB URLs of an already configured Radarr/Sonarr library, never Plex token URLs.
- Plex weekly statistics card: one embed (top movies/series, most active users, plays, watch hours of the last 7 days from Tautulli) in `#neu-auf-plex`, edited in place (message id in SQLite `plex_weekly_card`, content-hash dedupe, repost only if the message is gone). Weekly schedule via `PLEX_WEEKLY_ENABLED/DAY/HOUR` (default Monday 08:00, `TIME_ZONE`), channel override `DISCORD_CHANNEL_PLEX_WEEKLY`, manual refresh with `/wochenstatistik`. Tautulli errors are logged quietly, no Discord alarm.

### Fixed
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
