# Changelog

All notable MagguuBot changes. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Security
- `/ban`, `/kick`, `/timeout` enforce role hierarchy (invoker's highest role above the target's, guild owner exempt), reject self/bot/owner targets and keep the bot-side check, with German ephemeral errors.
- `/announce`, `/schedule-announce`, `/purge-user` check the invoker's permissions in the target channel(s); `/announce ping-role` requires a mentionable role or `Mention @everyone` in that channel.
- `/warn` auto-escalation (1h timeout and kick) uses the same role-hierarchy guard; the warning is still recorded, a denied escalation is skipped and the moderator is told why (ephemeral, German).
- Webhook rate-limit client IP: forwarded headers are only trusted from peers listed in the new `TRUSTED_PROXIES` (IP/CIDR allowlist, X-Forwarded-For walked right-to-left). `TRUST_PROXY=true` alone no longer trusts headers (startup warning).

### Fixed
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
