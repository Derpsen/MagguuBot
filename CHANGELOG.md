# Changelog

All notable MagguuBot changes. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed
- Discord Seerr Approve/Decline failed with HTTP 403 because MagguuBot used a stale Seerr API key. Doctor and service health now probe `/api/v1/request/count` (authenticated) instead of the public `/status` endpoint.

### Changed
- MagguuUI FAQ/install embeds synced to v12.1.2: skip Ellesmere start popup, Window & Tooltip Skins precheck, Edit Mode MagguuUI once, scale 0.58 from Magguu-Profile übernehmen / Magguu Settings, full WowUp starter + optional packs, 11 client locales, Skinning NAMEN & FARBEN DualRow (inkl. EXBoss-Split), Load profiles activate-only außer Klassenlayouts + KeystoneLoot-BiS, QoL Itemlevel.

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
