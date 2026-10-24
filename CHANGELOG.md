# Changelog

All notable MagguuBot changes. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Changed
- `/faq` autocomplete: choice name and value are limited to 100 UTF-16 code units (not code points) and cut on grapheme boundaries (`clipChoiceValue` added).
- Raid reminders to a channel re-check the subscriber's View + Send rights at send time (like the bot's); a subscriber who lost access or left pauses the subscription once (warn log, no alarm, no post, no ping).
- Slash-command gate: denials are logged (`warn`, command name + reason category only); chat-input dispatch moved to `command-dispatch.ts`, `handleInteraction` exported (behaviour unchanged) and covered by tests.
- "Neu hinzugefügt" digest follow-up: outage catch-up until Sunday 23:59 local (only after a previous run, once per slot, DST-safe, warn-once, no alarm); window upper bound `fetchedAt` so skewed Tautulli caches cannot repeat items; wiring tests (env/day/hour/channel order/enable switch/scheduler timers) and Plex card gateway tests against real discord.js payloads.
- docker.yml: GitHub build-provenance attestation (`actions/attest-build-provenance` v4.2.2, SHA-pinned, `attestations: write` on the build job only, GitHub attestation store only). Image content, Cosign keyless signing and uid 99 unchanged; no SBOM attestation, no cosign verify.
- Renovate: `helpers:pinGitHubActionDigests` added; satori lock updated from `~0.41.0` to `<0.48` (>=0.48 locked); h3/TS/@types/node locks unchanged.
- Drift guard: `tools/magguu-drift.py` (+ `tools/drift-allow.txt`) replaces `tools/drift-check.sh`; own `drift` job in `quality.yml` (alarm `needs` it) and a step in `.githooks/pre-push`; `quality.yml` no longer ignores `**/*.md`, so doc-only changes are checked too.

### Added
- `issue-route.yml`: labels new/assigned issues by title keywords (bug, security, dependencies, documentation); unclear issues trigger at most one JSON call to the escalation webhook (no body, https only, idempotent, `needs-triage` marker). Minimal permissions, no third-party actions.

### Changed
- Renovate: automerge now as PR (`automergeType: pr`, no platform automerge; Renovate waits for all checks), patch/pin/digest and stable (non-0.x) minor only, 0.x minors and majors manual, groups non-major only, `internalChecksFilter: strict`, 3 day release age also for github-actions minor/patch; `fileMatch` migrated to `managerFilePatterns`. Locked majors unchanged.

### Security
- Log scrubbing: `USERINFO` no longer has quadratic runtime (200 kB of `a.a.a.` took >20 s); scrub input is capped at 256 KiB with a marker; performance tests for every pattern (coverage unchanged, verified by differential fuzzing).
- `/purge` and `/slowmode` now check the invoker's rights in the channel (View + Manage Messages + Read History / View + Manage Channels, fail closed when the member cannot be resolved); before, the Discord role permission alone decided although the bot (Administrator) executes the action, so a channel overwrite denying the moderator was ignored.
- Central slash-command permission gate extracted to `command-gate.ts` (behaviour unchanged, now also fail-closed for an unparsable `default_member_permissions`); permission/hierarchy tests for all moderation commands and webhook-auth tests (token matrix, rate limit before auth, method/content-type, body limit, GitHub HMAC).
- Log scrubbing: JSON `"password":"x"` style bodies, `token:`/`api_key:`/`X-Api-Key:` free text, Discord bot tokens and webhook URLs without `/api/` are redacted; Plex card/weekly managers, `pin.ts` log `{ err }` through the serializer instead of `String(err)`; blue-tracker enrich errors and RSS `last_error` are scrubbed.
- `/ban`, `/kick`, `/timeout` enforce role hierarchy (invoker's highest role above the target's, guild owner exempt), reject self/bot/owner targets and keep the bot-side check, with German ephemeral errors.
- `/announce`, `/schedule-announce`, `/purge-user` check the invoker's permissions in the target channel(s); `/announce ping-role` requires a mentionable role or `Mention @everyone` in that channel.
- `/warn` auto-escalation (1h timeout and kick) uses the same role-hierarchy guard; the warning is still recorded, a denied escalation is skipped and the moderator is told why (ephemeral, German).
- Webhook rate limit split: pre-auth flood limit (300 unauthenticated req/min per IP, authenticated requests refunded/bypass) plus a per-webhook limit after auth (600 req/min per route source + credential hash; raw token never logged). An unauthenticated flood no longer throttles real *arr/GitHub webhooks.
- Webhook rate-limit client IP: forwarded headers are only trusted from peers listed in the new `TRUSTED_PROXIES` (IP/CIDR allowlist, X-Forwarded-For walked right-to-left). `TRUST_PROXY=true` alone no longer trusts headers (startup warning).

### Added
- CI alarm: `workflow_dispatch` input `test` (boolean, default false) in `ci-alarm.yml` sends one clearly marked test alarm on demand (main only, no `failure()` needed); logs only the HTTP status.
- `/faq suche:<Autocomplete> [privat]`: search the website FAQ (title, category, answer keywords; fuzzy, umlaut/typo tolerant); autocomplete is network-free (hourly cached list, ≤25 choices), answer as embed without pings. The hourly FAQ cache refresh now runs independent of the auto-answer channels.
- `/erinnerung an|liste|aus|fortsetzen`: user-defined Raid / Mythic+ / misc reminders (weekday + time in `TIME_ZONE`, optional text ≤100 chars, one-off or weekly, DM or channel with only the subscriber mentioned). SQLite table `raid_reminders` (migration via `CREATE TABLE IF NOT EXISTS`), 30 s scheduler tick, DST-safe next-run calculation, max 5 per user, only reminders ≤15 min overdue are sent after a restart, DM error 50007 pauses the subscription instead of alarming (`/erinnerung fortsetzen` resumes), `allowedMentions` strict.
- CI failure alarm: reusable workflow `.github/workflows/ci-alarm.yml`, called by `ci`, `docker` and `quality` (push to main, `failure()` only) posts repository, workflow, SHA, run URL and the last ~20 redacted log lines as JSON to the repo secret `ESCALATION_WEBHOOK_URL` with `Authorization: Bearer $ESCALATION_BEARER`. Skips quietly when a secret is empty, never turns a run red (continue-on-error, 10 s curl timeout), one alarm per run, none for re-runs, `Idempotency-Key` = sha256(repo|workflow|sha).
- `/neu [tage 1-30] [typ]`: new Plex movies/series of the last days from Tautulli `get_recently_added`, paginated ephemeral embed with page buttons (invoker only), 5 min cache, 5 s per-user cooldown, friendly error text instead of alarms. Posters only from public TMDB/TVDB URLs of an already configured Radarr/Sonarr library, never Plex token URLs.
- Plex weekly statistics card: one embed (top movies/series, most active users, plays, watch hours of the last 7 days from Tautulli) in `#neu-auf-plex`, edited in place (message id in SQLite `plex_weekly_card`, content-hash dedupe, repost only if the message is gone). Weekly schedule via `PLEX_WEEKLY_ENABLED/DAY/HOUR` (default Monday 08:00, `TIME_ZONE`), channel override `DISCORD_CHANNEL_PLEX_WEEKLY`, manual refresh with `/wochenstatistik`. Tautulli errors are logged quietly, no Discord alarm.
- "Neu hinzugefügt" digest: weekly (default Friday 18:00 `TIME_ZONE`, `PLEX_NEW_DIGEST_ENABLED/_DAY/_HOUR`) single embed with the movies/series added since the last digest (Tautulli `get_recently_added`, series grouped, ≤15 titles + `+N weitere`, clipped/escaped, strict allowed_mentions); nothing new = no post; last slot persisted in SQLite `plex_new_digest` (restart dedupe), catch-up only ≤15 min after the slot, permanent Discord errors pause 30 min with a warn log; channel `DISCORD_CHANNEL_NEW_ADDED` → `newOnPlex` → `weeklyDigest`.

### Fixed
- `/erinnerung an kanal:`: the invoker's View/Send check names the missing rights (`Dir fehlen in #kanal die Rechte: …`), threads and vanished channels get their own message; the reminder gateway wiring (`createReminderGateway`) is covered by tests.
- Clipping: `/faq` autocomplete names are cut on grapheme boundaries (code points, never inside a surrogate pair/flag/keycap) and `truncate()` no longer leaves a lone surrogate when the cut falls inside an emoji.
- Log scrubbing: bare GitHub tokens, JWTs, Discord webhook tokens and `password:`/`secret` free text are redacted; `index.ts` unhandled rejections and `discord-poster` failures go through the err serializer / `scrubString`.
- `/erinnerung`: reminders of members who leave are deleted; channel reminders check View/Send/EmbedLinks at send time and never post into `#updates` (paused once, warn log); `liste`/`aus` take `nutzer` for Manage Server moderators; creators get a one-time notice when a reminder was paused (no DM retry).
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
