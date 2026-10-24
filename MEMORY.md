# MEMORY.md

Helper memory for MagguuBot. Architecture and CI live in `AGENTS.md`.

## 2026-10-25 FAQ der Woche (Feature 1 of 3)

- Request (Marco, via Buddy): weekly top FAQ entry as ONE embed, anonymous, only with data. Rollback branch `rollback/pre-faqtop-170d553`. Rules: AGENTS.md "FAQ der Woche".
- Decisions: (1) data = `faq_usage_daily` (day, faq id, source, count), written by the hooks of the next commit (statistics feature); this commit only reads it, so before the hooks are live nothing is posted; (2) scheduling reuses the digest functions (`lastScheduledRun`, `catchUpDeadline`, `decideDigest`), own state table `faq_top_state`; (3) channel = override env, else `weeklyDigest`: NOT the `faq` key, because that channel holds the static FAQ content and no new key means `/doctor` stays quiet; (4) no question text is stored, titles are read from the website FAQ cache at post time and unknown ids are dropped; (5) minimum 3 uses per week.
- Tested with real discord.js payloads (EmbedBuilder, MessagePayload.resolveBody), fake Discord and clock; the real first post is not yet seen. New optional envs: `FAQ_TOP_ENABLED` (true), `FAQ_TOP_DAY` (1 = Monday), `FAQ_TOP_HOUR` (10), `DISCORD_CHANNEL_FAQ_TOP` (empty).

## 2026-10-24 Plex cards per user + one-time cleanup

- Request (Marco, via Buddy): one self-updating Plex card per Plex user instead of one shared card, then delete the old cards ("die ganzen vorherigen Posts, also die Karten, weg"). Rollback branch `rollback/pre-usercards-2290461`. Details/rules: AGENTS.md "Plex activity cards (one per Plex user)" and "One-time cleanup".
- Decisions: (1) manager state, debounce, hash, backoff and repost cooldowns are per card, the pause on 10003/50001/50013 is per channel (one warn instead of 25 failing calls); (2) migration seeds user cards from the old single card state with message id null, so cards are posted one by one 3 s apart; the old row stays and is protected from the cleanup via `protectedMessageIds`; (3) the new card footer `MagguuBot · Plex-Nutzerkarte (wird aktualisiert)` is deliberately NOT in the cleanup list and not a routed legacy footer; (4) the cleanup is an automatic gate in the 30 s tick (no manual trigger), result in `plex_cleanup_state` (`done`/`failed` final, `aborted` retried after 6 h, max 3 attempts); (5) cap 25 users, throttled warn; (6) logs use an 8 hex tag, no names.
- Tested with real `EmbedBuilder`/`MessagePayload.resolveBody` payloads and fake channels (bulkDelete throws); real Discord deletes and the real message history of the channel are not yet seen. First live check: Container log for `Plex card cleanup: candidates found` and `Plex card cleanup finished` (field `deleted`).
- Deploy: green Docker publish → autoupdate. New optional envs: `PLEX_CARD_USER_ALIASES`, `PLEX_CARD_USER_EXCLUDE` (empty), `PLEX_CARD_CLEANUP_ENABLED` (true), `PLEX_CARD_CLEANUP_DRY_RUN` (false), `PLEX_CARD_CLEANUP_SCAN_LIMIT` (1000). Unraid XML unchanged. Known leftovers: pinned info card text in `src/embeds/cards.ts` still says "Eine Karte pro Stream"; cards of users who get excluded/aliased away later stay (protected from cleanup).

## 2026-10-24 Plex card hardening (review findings on 4c7b538)

- Failure counter used to count the debounce retry timer and the 30 s tick separately (threshold 5 reached after ~2-3 min) → now one counter per real Discord attempt with exponential backoff (`backoffUntil`), skipped flushes return `retry` without counting. 10003/50001/50013 → `pausedUntil` (30 min, option `permanentPauseMs`), quiet `warn` log, never a repost. Fold-time caps user 40 / player 40 / title 150 (assumed from the review note "150/40/40"), markdown/mention escaping at render (`escapePlexMarkdown`). Tests: `tests/plex-card-hardening.test.ts` (incl. real SQLite temp DB + second boot, `goneCooldownMs`). The first edit after deploy may change the card hash once (escaped text).

## 2026-10-24 Plex weekly statistics card (Welle a)

- Request (Marco): weekly Tautulli statistics as ONE edited card. Rollback branch `rollback/pre-wochenstatistik-4c7b538`. Details/rules: AGENTS.md "Plex weekly statistics card".
- Decisions: (1) no new `ChannelKey`: a new catalog key would show up as "stored id missing" in `/doctor`/daily self-check (ops alarm) and needs new live-id fixtures, so the card uses the `weeklyDigest` channel (`neu-auf-plex`) with optional env override `DISCORD_CHANNEL_PLEX_WEEKLY`; (2) own table `plex_weekly_card` with a `message_id` column so `protectedMessageIds` (rollout cleanup) never deletes the card, and footer `MagguuBot · Plex-Wochenstatistik` is classified as `weeklyDigest` for the acceptance scan; (3) totals come from `get_plays_by_date` (plays + duration series, sums over all media types); the per-row `total_plays` of home stats only cover the top rows, so they are only the fallback; (4) only 10008/50005 repost, everything else is a quiet retry on the next 30 min tick (a weekly card must not flood); (5) `/wochenstatistik` needs Manage Server, ephemeral reply, shares the 10 min stats cache.
- Tested only with fakes/fixtures (hand-written Tautulli shapes, in-memory store, recording gateway); the real Tautulli payload of `get_plays_by_date`/`get_home_stats` and real Discord edits are not yet seen. First live check: `/wochenstatistik` after the deploy.
- Deploy: green Docker publish → Unraid pull. New optional envs: `PLEX_WEEKLY_ENABLED`, `PLEX_WEEKLY_DAY`, `PLEX_WEEKLY_HOUR`, `DISCORD_CHANNEL_PLEX_WEEKLY`; defaults work without setting anything (needs Tautulli URL/key and the weeklyDigest channel). Slash command count 52 → 53 (re-registered automatically at boot). On first start after deploy the card is posted once (period of the last Monday is due).

## 2026-10-24 Plex card flood → single card

- Symptom (Marco): "wieder hunderte" Plex cards in `🎬・plex-aktivität`. No earlier fix for this exact flood in MEMORY/git log: lifecycle cards (75fe681, 73c4b76) and the stale-session tick (4f4582c) only limited cards per session; the 2026-10-22 flood fix (0ee51f2) covered Arr deletes/grabs/imports/neu-auf-plex, not playback. Rollback branch `rollback/pre-plex-card-76f2c9b`.
- Root cause (code reading, live DB not inspected): playback was one card per correlation key, and (1) Tautulli Discord-format payloads got a key from user+player+*notification text*, so play/pause/stop of one stream got different keys (or `null` without User/Player fields = untracked, never edited, never retention-deleted) → each event posted a new card; (2) every `play` older than 2 min posted a new card (each episode/reconnect/auto-play); (3) any failed edit (not only deleted message) fell through to `postEmbed`; (4) no debounce/hash, so bursts (buffer/pause/resume) and redeliveries produced edits/posts.
- Decision: ONE card per channel, edited in place, never a new message per event. Why not "new post on play/stop": that is exactly what flooded the channel; edits do not ping and keep history compact. "Someone watched" stays visible in the card's "Zuletzt" list (last 6). New post only when the message is missing/gone (10008, 50005) or ≥5 failed edits, with repost cooldowns. State + message id in SQLite `plex_activity_card` (same DB as everything else, backed up, survives restart).
- Not deleted: old cards stay. Tracked old cards (from `plex_activity_messages`) are removed by the existing retention (`PLEX_ACTIVITY_RETENTION_DAYS`, default 7); untracked ones (null key) are recognisable as: author = bot, channel `plex-aktivität`, not pinned, embed footer not `MagguuBot · Plex-Aktivität (eine Karte, wird aktualisiert)`, title `▶️ Spielt ab` / `⏸️ Pausiert` / `⏹️ Gestoppt` / `✅ Zu Ende geschaut` / `🔄 Buffering`. Bulk delete = separate, explicit decision by Marco.
- Deploy: needs the green Docker publish, then Unraid pull (Plex session gate if a restart is needed). First events after deploy post the new card once.

## 2026-10-23 Security audit fixes

- Audit `~/security-audit-skill/magguubot/run-20261023/REPORT.md`: MEDIUM hierarchy bypass (ban/kick/timeout only checked bot side) fixed via `checkModerationTarget`; LOW invoker channel perms (announce/schedule-announce/purge-user) and `ping-role` mention bypass fixed via `channel-authority.ts`.
- Rate limit before auth: live Unraid container had no proxy env (TRUST_PROXY unset → socket IP only, not spoofable). Container br0 192.168.178.9 (no port mapping, LAN-reachable), CloudflaredTunnel br0 192.168.178.19 → all tunnel traffic shares one 120/min bucket. Fix: explicit `TRUSTED_PROXIES` allowlist (Website 0f1c7ef model); optional Unraid env `TRUSTED_PROXIES=192.168.178.19` for per-client buckets (not set, Marco decides).
- Code review follow-up (diffreview-20261023): Unraid & Server set `TRUSTED_PROXIES` live at 22:10 Berlin. Rate limit split anyway (`webhook-guard.ts`): pre-auth 300 unauth req/min/IP, post-auth 600 req/min per webhook identity (`source:sha256[0:12]`). Residual: GitHub HMAC cannot be prechecked, so a GitHub delivery is only throttled if its own source IP floods unauthenticated requests.
- Follow-up same day: `/warn` auto-timeout and auto-kick now go through `checkModerationTarget` (`warn-escalation.ts`); warning always stored, denied step skipped with reason (`⏭️ Auto-Timeout übersprungen (n ≥ m): …`). Auto-kick was included because it had the same bypass.

## 2026-10-22

- Discord overhaul code is in `main`: lean layout in `src/discord/server-layout.ts` (5 categories / 17 channels / 11 roles), shared planner `src/rollout/plan.ts`, CLI `dist/rollout/discord-rollout.js`. Live server is **not** rolled out yet; runbook in AGENTS.md "Server layout & rollout".
- Live facts (read-only audit): bot role (pos 16) is below Admin (18) / Moderator (17) → their permission edits stay manual until the bot role is dragged above. All 17 own roles + @everyone had MENTION_EVERYONE. `autoRoleId` was the `__magguu_newcomer__` sentinel. Community/onboarding/welcome screen were off.
- `FAQ_AUTOANSWER_CHANNEL_IDS` is env-only (Unraid template); after rollout set it to the `❓・hilfe` id (same id as old `❓・faq`).
- Maintainerr removed from the bot (container gone on Unraid since 2026-08-01): no route, source, channel key, env var or embed any more. Library-delete cards from Sonarr/Radarr post to `health` (`🩺・status`). Startup migration drops only the `maintainerr` `channel_config` row and marks pending retries for it exhausted; old `webhook_events` rows stay. The Unraid env `DISCORD_CHANNEL_MAINTAINERR` is now ignored and can be deleted from the template.
- Cards/acceptance: Blue-Tracker → own `🟦・blizzard-updates`; Plex activity → own `🎬・plex-aktivität`; `📡・downloads` = Sonarr/Radarr/SABnzbd only, one pinned live card. Ticket panel is a pinned card in `❓・hilfe`. Public updates channel (`📢・ankündigungen`, set by Marco) is never changed by code. Runbook: AGENTS.md "Cards, pins & acceptance".
- Acceptance follow-up (sha-5275385 run, exit 6): `/cleanup-server` description had `🗄️` (U+FE0F); now plain text, compare normalised (FE0F dropped), startup reads back guild commands and re-PUTs on drift (U&S later saw slash 52/52 green on the old image, so this is hardening). Section 5 root cause (U&S live read 20:16): the bot's own 5-min topic ticker overwrote anfragen/freigaben/status/downloads with English counters (`📝 Film / Serie requesten · 0 pending` …). Unified: topic = layout purpose + ` · ` + German counter, updater edits only on change and ≥ 6 min per channel, rollout/acceptance accept the counter suffix. Rollout now verifies PATCH results and reports Discord's 2-per-10-min name/topic limit. `Library-Löschungen` stays (Sonarr/Radarr delete cards post to status).
- 2026-10-22: 2 old Blizzard/Blue-Tracker posts sat in 📰・updates; move tool: `discord-acceptance --move-misrouted blizzard` (U&S runs it); section 2 now flags any non-MagguuUI bot post in updates as error.
- Flood 2026-10-22 20:00–20:22 Berlin: ~530 deliberate deletes via Sonarr/Radarr API → 530 single delete cards in 🩺・status (footer `File aus der Library entfernt`). Fixed with burst protection (deletes bundled, grabs/imports/neu-auf-plex >5 per burst → summary, import de-dupe incl. SAB+Arr) before the staged re-import (09/13/17/21 h, ~534 items). Cleanup: `discord-acceptance.js --cleanup-window 2026-10-22T18:00Z 2026-10-22T18:30Z` (dry-run, then `--apply`).
- Admin panel: 8 sidebar entries in 4 sections, homepage style (#0B1118 / #0CD29D / #45E0BB, Plus Jakarta Sans + JetBrains Mono).

## 2026-09-10

- Live Unraid container `MagguuBot` / `ghcr.io/derpsen/magguu-bot:latest` after `d095062`.
- `getChannel` caches per process; `saveChannel` updates the Map (setup-server, ticket-buttons, admin).
- `pino-pretty` is `devDependencies` only. `formatBytes` for `/botinfo` comes from `src/embeds/colors.ts`.
- better-sqlite3 is **13** (AGENTS.md).

## MagguuUI product facts (2026-10-05)

- EllesmereUI TOC min **9.0.6+**; live host **9.2.9**; Magguu Ellesmere bake is **dump-based**; release notes reference **v12.1.8** (latest MagguuUI tag).
- Four sibling AddOns: MagguuUI / MagguuUI_Data / MagguuUI_EUI / MagguuUI_Media (all enabled).
- Gold **Magguu-Profile übernehmen** (EN: Apply Magguu profiles) = Magguu profiles + Magguu Settings + companions. **Magguu Settings** = overlay/QoL/fonts/scale/chat only (no re-import). **Load profiles** = activate Magguu profiles; no re-import except a missing companion once; class layouts per character. Setup buttons: BigWigs, Northern Sky, EXBoss, Smart Reminders, Whisper Messenger.
- Player-facing FAQ/welcome never says bake, dump, or recapture.
- Ellesmere bake is **dump-based** (Magguu multi-export; dump values win, Magguu overlay only). Fresh / new bake changes need Magguu-Profile übernehmen.
- **Targeted Spell Bars** (Ellesmere Nearby Cast / Mythic+ Tools) ON via Magguu-Profile übernehmen; keep **EXBoss MythicCast OFF** (same job — do not run both).
- MagguuUI_EUI: **Boiling Point** kept. **TopBar / Hearth-Picker / Magguu FPS-MS removed** — no FAQ promises for them. AuraBuff bag/group **count CENTER**.
- Magguu does not join, leave, or hide Services. Players manage that channel.
- Bot copy/docs/AGENTS/MEMORY: person names only **Magguu** / **MagguuUI**. Scrub foreign author/person credits. Keep addon **product** names (EllesmereUI, BigWigs, EXBoss, …). Never set Magguu as author of a foreign addon.
- FAQ/welcome embeds must not name foreign authors (enforced in `tests/features.test.ts`). Discord field values ≤ 1024 chars.
- Public tone: factual Magguu voice; public contact **contact@magguu.xyz**.
- Store listings (CurseForge / Wago / WoWI) are MagguuUI `docs/store-descriptions/`. WoWI logo is GitHub raw `logo-300.png`, not `ui.magguu.xyz`.

## WowUp packs (2026-10-05)

- **Starter:** EllesmereUI, MagguuUI, BigWigs, LittleWigs, Northern Sky, EXBoss, EXCore.
- **Optional:** BugGrabber, BugSack, HandyNotes, HandyNotes MapNotes, MDT, Raider.IO, Simulationcraft, Talent Tree Tweaks, Whisper Messenger (WhisperMessenger), Waypoint UI, GTFO, Premade Groups Filter, Auctionator, Smart Reminders.
- Whisper Messenger is the whisper addon. WIM and Ellesmere WIM Skin are retired. Do not list them or import WIM.
- No WindTools. HandyNotes MapNotes is on WowUp Optional; Magguu settings apply with HandyNotes via Magguu-Profile übernehmen / Profile laden. No KeystoneLoot / Archon-BiS / KSL-BiS in user-facing copy or Optional pack; never MagguuKSL; never name Devourer as a special include. Skinning DualRow has no EXBoss split names.

## 2026-09-14 hard-refactor

- `ChannelKey` / dashboard labels live in `src/discord/channel-catalog.ts` (`CHANNEL_CATALOG` + `isChannelKey`). `channel-store` re-exports and owns SQLite/env fallbacks. `PERSISTENT_KEYS` / admin `CHANNEL_KEYS` removed as duplicates.
- Shared *arr Zod shapes: `arrImage` / `arrMediaFile` / `arrRelease` in `schemas.ts`.

## 2026-09-27 autonomy

- Discord Admin-Smoke OK/BLOCK template in `AGENTS.md` (OAuth/session required; no invented success).
- Merge reports: Actions-only vs App-Image; "Unraid & Server" pulls after green App-Image docker.
- Pack/copy product-fact deltas: update Bot with Website + Magguu-Dashboard same round.

## 2026-10-05

- Docs/FAQ refresh: Whisper Messenger replaces WIM / Ellesmere WIM Skin in WowUp Optional (FAQ embed + test); bake dump-based; notes v12.1.8; public contact contact@magguu.xyz.

## 2026-10-06 Ops sync (Buddy Inventur)

- #97+#98 merged; Container-Baseline digest `sha256:07b2cf08a14636e7e4593ab8a6f204efaa545157eff3c2acae75baf0a3ce4b61` (OCI `sha-db54e38` / tip `db54e38`) - already live, kein Re-Pull (Stand 2026-10-06; superseded, see "2026-10-22 Docs drift check" below: last recorded `sha-69f8d95` / `sha256:a5827ffe…`, 2026-10-14).
- Discord `/setup-server full` Done - embeds **Whisper Messenger**, nicht WIM / Ellesmere WIM Skin.
- Pack-/Author-HARD unveraendert; Optional = Whisper Messenger (WhisperMessenger).
- Prefer Done-Wave Capture after App-Image waves; keine neuen Specialist-Bots.

## 2026-10-12 Facts refresh

- MagguuUI addon live **v12.1.8**.
- Container runs as **uid 99** (entrypoint drops to `PUID=99`/`PGID=100` via su-exec; `PUID=0` keeps root). Images are signed with **Cosign keyless** (GitHub OIDC) in `docker.yml`.
- **WIM is removed** everywhere. Whisper Messenger is the whisper chat in embeds/FAQ. Player button: **Apply Magguu profiles**.
- Node: `engines.node >=26`, Node 26 live (Marco approved 2026-10-16).

## 2026-10-12 Docs/Bots-Sync

- Helpers (renamed again 2026-10-16, IDs unchanged): "Website" = MagguuUI-Website only; "Bot & Dashboard" = MagguuBot + Magguu-Dashboard; "Addon (Lua)" = addon Lua; "Code-Review" = review on request; "Release" = releases/Tag-Gate; "Unraid & Server" = Unraid; Buddy = front door. Former names: Webcraft, Botsmith, Luaforge, Sentinel, Launchpad, Homebase. Captain and all group chats/rooms were deleted 2026-10-16; Buddy contacts helpers directly; Notion holds only rules and the daily Docs-Abgleich log.
- Buddy makes small MagguuUI-Website design/text changes directly; bigger work goes to the helpers. Since 2026-10-12 helpers and Buddy push directly to `main` (no PRs, no pre-review); Buddy reviews commits afterwards; after a green Docker publish the no-AI Unraid pull/test script (`magguu-pull`, rollback on failure) pulls the new image.
- Addon live v12.1.8. "Split names" options are becoming "Two-tone unit-frame names" / "Two-tone party and raid names" (MagguuUI PR #30; `SPLIT_NAMES` keys unchanged): half the name in the default color, half in the class color.
- Website live `sha-d8e734a` (digest `sha256:516f6c21…`, 2026-10-14: admin restyle, admin save clears cache, `/admin/content` shows a page list) — superseded: live since 2026-10-14 late evening is `sha-5db94ed` (digest `sha256:abfe0d1d…`, v12.1.8 changelog notes; superseded 2026-10-17 by `sha-6dc9870`, build id `da0941f8`, Node 26); legal notice = "free, non-commercial project operated from Switzerland" + `contact@magguu.xyz` (no name, no address).
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

## 2026-10-15 Arbeitscomputer

- Helfer-Arbeitscomputer ist die Unraid-VM `Ubuntu` (machineId `3ff4cee8-7e7c-4cc9-a262-ebf10016d570`). Repos bereit unter `~/Projekte` (Buddy 2026-10-15). Marcos PC (`f01cf815-a384-40fb-ac18-c8450b4d5889`) nur noch für WoW-AddOns-Deploy, darf aus sein.
- "Bot & Dashboard" schreibt Marco nie im 1:1; Status/Done nur an Buddy.

- 2026-10-16: Renovate branch-automerge (minor/patch/pin/digest after green CI, majors manual; TS<7, @types/node<25 locked). Pre-push hook `.githooks/pre-push` (checks + actionlint + shellcheck), enable via `git config core.hooksPath .githooks`; VM checkout enabled.
- 2026-10-16: docker.yml push paths allowlist; non-image pushes (docs, hooks, renovate.json, tests) no longer publish an image. Renovate App active (Dependency Dashboard #111).
- 2026-10-23 License (Buddy, delegated by Marco): MagguuUI declares GPL-3.0 (TOC `X-License`, no LICENSE file; EllesmereUI-module context, not applicable to own repos), MagguuUI-Website has none → MIT chosen for Bot + Dashboard. Inventory: production deps MIT 55 / BSD-2 10 / Apache-2.0 9 / ISC 2 / 0BSD 1; dev-only MPL-2.0 4 / CC-BY-4.0 1 / OFL-1.1 2 (fonts, bundled → THIRD-PARTY-NOTICES.md). No copyleft in production. Logo/favicons are own work. Same day (Marco): copyright holder changed to `Magguu` (LICENSE, package.json `author`); repo owner, GHCR path and git identity stay Derpsen; font authors' lines untouched.
- discord.js 15 only when stable and bundling undici 8; until then undici <8 lock stays.
- 2026-10-23 (Buddy decision): private vulnerability reporting enabled + SECURITY.md; dismissed #99/#100 (false positive) and #101/#107 (won't fix). Open: #102 TokenPermissions (fixed in 8bea5d7, closes on next Scorecard run), #104 SecurityPolicy (should close with SECURITY.md), #105 Fuzzing, #106 License (MIT added same day), #108 CII.
- 2026-10-23 knowledge refresh #1 (repeat every 3 weeks): Node 26.12.1 (security, 2026-10-21) → base image bumped from 26.12.0 digest; Renovate now tracks it (regex manager). TypeScript latest 7.0.2 (we 6.0.3, locked <7); @types/node 24.x (locked <25 / never 26 without Marco). discord.js 14.27.0 / @discordjs/rest 2.6.3 latest stable still undici ^6.27; v15 dev (discord.js 15 / rest 3) uses undici ^8.10 → undici 8 arrives with the discord.js 15 major; cheerio 1.2 still ^7.19. h3 2.0.8 / js-yaml 5.5.0 latest (locked). Actions behind (Renovate Monday): checkout 7.0.1, setup-node 7.1.0 (major), build-push 7.4.0, setup-buildx 4.4.1, login 4.6.0, codeql 4.39.1; cosign-installer 4.1.2, scorecard 2.5.0, trivy 0.36.0, dependency-review 5.0.0 current. Docker build already has provenance + SBOM + cosign keyless signing. Security: CodeQL advanced setup (default setup not configured, keep); push protection on; Dependabot alerts on (0 open); private vulnerability reporting off. Alerts: #99/#100 incomplete-multi-character-sanitization = false positive (output is Discord markdown, not HTML); Scorecard #102 TokenPermissions fixed (job-level security-events); #101 BranchProtection/#107 CodeReview = by design (direct push to main); #104 SecurityPolicy/#106 License/#105 Fuzzing/#108 CII = need Marco's decision.
- 2026-10-23: Renovate PR #112 (undici → 8.12.3 in all three overrides) closed: lockfile out of sync (`npm ci`: Missing undici@8.12.3 → typecheck + scan red), and 8.x is outside discord.js/@discordjs/rest `^6.27` and cheerio `^7.19`. dependency-review failed only because the repo's Dependency graph is disabled (settings). renovate.json now: undici `<8`, no undici majors.
- 2026-10-16: deps refreshed (non-major + undici overrides 6.29.1/7.30.1, esbuild 0.28.2); discord.js 14.27 already latest stable, undici 8 not applicable (transitive, discord.js needs ^6, cheerio ^7).
- 2026-10-16: Node 26 live: engines >=26, Dockerfile node:26-alpine@sha256:6f08a523…, CI/docker/version-check Node 26, Renovate Node hold removed.
- Security (2026-10-16): `scorecard.yml` (ossf/scorecard-action v2.5.0, SHA-pinned; push main + weekly; SARIF → code scanning, upload-sarif SHA = codeql.yml SHA, bump together) and `dependency-review.yml` (actions/dependency-review-action v5.0.0, PRs, fails on >= moderate). Secret scanning + push protection enabled via `gh api` (verified enabled).
- Quality (2026-10-16): `.github/workflows/quality.yml` runs the job `drift` (`python3 tools/magguu-drift.py --repo bot --allow tools/drift-allow.txt --gha`; since 2026-10-24 replaces `tools/drift-check.sh`, stdlib-only, read-only; checks forbidden names, engines.node >=26 vs Dockerfile/CI Node major, locked majors in package.json (ERROR) / lockfile (WARN), container USER/PUID 99 + cosign keyless in docker.yml; exit 1 only on ERROR; allow list `tools/drift-allow.txt`, currently empty; also in `.githooks/pre-push`). `quality.yml` has NO `paths-ignore` any more, so doc-only changes run the drift job too (AGENTS/MEMORY/CHANGELOG are scanned), actionlint 1.7.12 + zizmor 1.31.1 (medium+) + shellcheck + osv-scanner 2.7.0 (downloads sha256-verified). All workflows hardened for zizmor: checkout `persist-credentials: false`, docker.yml packages:write only on build job and no npm cache (package-manager-cache: false).

- 2026-10-23: advisory zizmor workflow `.github/workflows/zizmor.yml` added (zizmor-action v0.8.0 SHA-pinned, non-SARIF, continue-on-error, not required). Findings not fixed yet, pending Buddy review.
- 2026-10-23 (Buddy-approved follow-up): zizmor info `template-injection` fixed (docker.yml Sign image uses step env `IMG` instead of `${{ steps.img.outputs.name }}` in run); stale `# actions/checkout@v7.0.0` comments → `v7.0.1` (SHA unchanged). zizmor now clean.
- 2026-10-23: Reporting an Buddy (ab 2026-10-23): genau eine Done-Meldung pro Auftrag, max. ~800 Zeichen plus Pfad/Commit für Details; Zwischenstände nur bei Aufträgen über 30 Minuten.

## 2026-10-22 Docs drift check

- Adopted `tools/docs-drift.sh` (1:1 from MagguuUI-Website) + `.github/docs-drift-rules.txt` + `docs-drift.yml` (Mon 05:17 UTC + dispatch; issue "Docs-Drift" → Derpsen on hits, closed when clean). No `@health-url` (`/api/status` is Bearer-gated, no public health URL).
- Baseline fix: AGENTS.md no longer names live sha/digests (rule scoped to AGENTS.md). Removed AGENTS lines, kept here as history:

  > - (updated 2026-10-15) Container `MagguuBot` / `ghcr.io/derpsen/magguu-bot`: digest `sha256:07b2cf08a14636e7e4593ab8a6f204efaa545157eff3c2acae75baf0a3ce4b61` (OCI `sha-db54e38` / tip `db54e38`) is the **2026-10-06 baseline (superseded)**. Last recorded Bot image (Notion Tag-Gate note 2026-10-14 ~23:39 Berlin, next to the live Website digest): OCI `sha-69f8d95` / digest `sha256:a5827ffe879da787aa6ff3e3f9012a96815eb7fef7a7e0cbd2d186dbee3ae82f` (includes the 2026-10-14 waves: `/status`, release poller, FAQ auto-answer, `/api/status`). GHCR `:latest` is now `sha-cb706c3` (`sha256:53f13eb5…`, green docker publish of a MEMORY-only commit → no "Unraid & Server" pull needed).
  >
  > - Website live `sha-d8e734a` (digest `sha256:516f6c21…`, 2026-10-14: admin restyle, admin save clears cache, `/admin/content` shows a page list) — superseded: live since 2026-10-14 late evening is `sha-5db94ed` (digest `sha256:abfe0d1d…`, v12.1.8 changelog notes; superseded 2026-10-17 by `sha-6dc9870`, build id `da0941f8`, Node 26); legal notice = "free, non-commercial project operated from Switzerland" + `contact@magguu.xyz` (no name, no address).

## /neu (new on Plex) — wave b
- Request (Marco): slash command `/neu` for new movies/series of the last N days. Rollback branch `rollback/pre-neu-9a45cd0`. Details: AGENTS.md "`/neu`".
- Decisions: (1) data only from Tautulli `get_recently_added` (Plex ground truth); Sonarr `added` dates mean "added to Sonarr", not "on Plex", so they are not used as a fallback; (2) posters: Plex/Tautulli thumbs need a token -> omitted; optional poster from the Radarr/Sonarr library `remoteUrl` through the `safePosterUrl` allowlist (https, tmdb/tvdb/fanart, no query); (3) page state lives in the customId (no DB), owner check on buttons; (4) ephemeral like `/plex-top`, 5 s cooldown per user, no Discord permission restriction.
- Tested only with fakes/fixtures (hand-written Tautulli shape, faked `fetch`, fake button interaction); the real `get_recently_added` payload (esp. season vs episode entries for shows) and real Discord rendering are not yet seen. First live check: `/neu` and `/neu typ:Serien tage:30` after the deploy.

## CI failure alarm
- `.github/workflows/ci-alarm.yml` (workflow_call) + an `alarm` job in `ci.yml`, `docker.yml`, `quality.yml` (`if: failure()`, push on main only). Secrets `ESCALATION_WEBHOOK_URL` / `ESCALATION_BEARER` are GitHub repo secrets, never in Git/logs; the step prints only "set yes/no" and the HTTP status. Payload fields: repository, workflow, sha, run_url, log_tail (<=20 lines, lines with token/secret/bearer/authorization/password/key= are replaced by `[line redacted]`). Logs come from the failed job via the Actions API with `GITHUB_TOKEN` (`actions: read`). Tested locally with stubbed `gh`/`curl` (redaction, skip paths, no secret in output/args); the real webhook call is only seen after the first real main failure.

## /erinnerung (Raid / M+ reminders) — wave c
- Request (Marco): user-defined, subscribable reminders (kind, weekday + time, optional text, weekly or one-off). Rollback branch `rollback/pre-erinnerung-e893697`. Details: AGENTS.md "`/erinnerung`".
- Decisions: (1) separate from `/remindme` (relative one-shot); (2) `next_due_at` stored, not recomputed from a schedule, so a restart can't create a backlog; (3) DST: ambiguous time → first occurrence, non-existent → shifted past the gap, never skipped; (4) 50007 pauses (no alarm), user lifts it with `/erinnerung fortsetzen`; (5) channel delivery refuses `#updates` (acceptance scan treats anything else there as a finding).
- Tested only with fakes: in-memory store + fake gateway (no real Discord DMs/channel sends), fake interaction objects for the command; time maths uses real Intl, store tests use a real temp SQLite incl. migration on a legacy DB. Not seen live: real 50007 payload shape (`code` property assumed as with other Discord errors), real permission resolution for the channel option. First live check: `/erinnerung an art:Raid tag:... uhrzeit:...` with a near time, then DM arrival.

## Review follow-ups (low findings of e893697/cfd03c0 and wave b)
- CI alarm: `redact_log` markers `# redact-begin/end` in `ci-alarm.yml` are executed by `tests/ci-alarm-redact.test.ts` (Dashboard: `tests/test_ci_alarm_redact.py`); replacement markers must not contain keywords like `token`/`secret`, else the keyword filter drops the whole line.
- `/neu`: negative cache 45 s (`NEU_FAIL_TTL_MS`), button cooldown 1.5 s; Tautulli logs go through `errSerializer`; Plex activity card failure repost deletes the old tracked message best-effort (`PlexCardGateway.delete`, optional).
- Tested only with fakes (fake gateway/fetch/clock); real Discord delete permissions (needs Manage Messages only for foreign messages; own message needs none) not seen live.

## 2026-10-24 /faq search (Welle d, part 1)
- New `/faq suche:<autocomplete> [privat]` over the website FAQ cache (`faq-autoanswer.ts` `getCachedFaqEntries`; ranking in `src/utils/faq-search.ts`); command count 56. Autocomplete never touches the network; with a cold cache (before the first hourly refresh succeeded) it returns no choices, execute then loads the list. Hourly refresh is now always on (was only with `FAQ_AUTOANSWER_CHANNEL_IDS`).
- Choice value = FAQ id (≤100 chars), unknown id → friendly embed with page link + contact@magguu.xyz; free text resolves best hit + up to 4 similar questions.
- Tested only with fakes (fake interaction, in-memory cache); real autocomplete latency/Discord rendering not seen live.

## 2026-10-24 CI alarm test path (Welle d, part 2)
- `ci-alarm.yml` has `workflow_dispatch` input `test`; job `if` lets the dispatch run only on main with `test=true`, called runs are unchanged (`failure()` gate stays in the callers). Test payload: workflow `<name> TEST (kein echter Fehler)`, log_tail `CI-Alarm Test, kein echter Fehler`, Idempotency-Key by run id.

## 2026-10-24 /erinnerung review follow-ups (low findings of 5d2e110)
- Scrub: `scrub.ts` now covers bare GitHub tokens, JWTs, Discord webhook tokens, free-text password/secret; `index.ts`/`discord-poster.ts` log via serializer (`{ err }`). New column `raid_reminders.pause_notified_at` (CREATE TABLE + `addColumnIfMissing`; `ensureSchema`/`runMigrations` are exported and tested for double runs).
- Leave cleanup in `guild-member-remove.ts`; `assertReminderChannelAllowed` in `raid-reminders.ts` (permissions + addonUpdates lock, code 50013 → one pause). Moderators (ManageGuild) via `nutzer` option.
- Tested only with fakes (fake interactions/channels/permissions, in-memory + temp SQLite); real Discord permission resolution and real `guildMemberRemove` payloads not seen live. The poster/index call sites are covered by a source-level regression test plus serializer tests, not by a live Discord failure.

## 2026-10-24 "Neu hinzugefügt" digest (Welle e)
- Decisions: (1) window = since the data time of the last run (`last_run_at`), not the slot time, so the 5 min Tautulli cache cannot lose items; first run 7 days; skipped (stale) slots are not recorded and the next digest covers the longer window; (2) slot = first moment of the weekday whose local hour is >= configured hour (DST gap fires after the gap, repeated hour counts once); (3) the slot is only recorded after a successful post or an empty result, a failed post/fetch retries on the 5 min tick inside the 15 min grace; (4) stale Tautulli fallback data (> 10 min old) counts as unavailable; (5) no new `ChannelKey` (would trigger `/doctor` alarms): override env → `newOnPlex` → `weeklyDigest`; (6) default enabled, Friday 18:00.
- Deploy: green Docker publish → Unraid pull; new table `plex_new_digest` is created on first start; new optional envs `PLEX_NEW_DIGEST_ENABLED/_DAY/_HOUR`, `DISCORD_CHANNEL_NEW_ADDED`. The first digest after the pull posts at the next Friday 18:00 Berlin.
- Tested only with fakes: fake gateway/Tautulli/clock/in-memory store plus a temp SQLite for the store; real Discord permissions in the target channel and real Tautulli data not seen live.

## 2026-10-24 Permission/hierarchy and webhook-auth tests + review follow-ups (Welle f)
- Rollback branch `rollback/pre-permtests-2d32080`. Gaps found and fixed minimally: `/purge` and `/slowmode` had no invoker channel-permission check (bot is Administrator, so a channel overwrite denying the moderator was ignored; now `invokerChannelError` with `PURGE_CHANNEL_PERMS` / new `SLOWMODE_CHANNEL_PERMS`, fail closed). Central gate extracted to `command-gate.ts` so it is testable (behaviour-neutral; unparsable `default_member_permissions` now denies).
- Decisions / known by design (not changed): `/warn` always records the warning, only the escalation is hierarchy-guarded; a transient failure of the target `members.fetch` is treated as "not a member" (ban skips the hierarchy compare, Discord's bot-hierarchy still applies); webhook routes ignore Content-Type (invalid JSON = 400) and the 1 MiB body limit runs before auth (oversized = 413 even with a bad token); leading/trailing whitespace in a header value is trimmed by the HTTP layer (standard).
- Review follow-ups: scrub patterns (JSON secrets, `token:`/`api_key:`/`X-Api-Key:`, Discord bot token, webhook URL without `/api/`); `String(err)` log sites replaced by `{ err }`; `createReminderGateway` factory so the `sendChannel` wiring is testable; `clipChoiceText` uses graphemes, `truncate()` is surrogate-safe. `/erinnerung` creation check already existed, now with clear German message listing the missing rights.
- Deploy: green Docker publish → Unraid pull; no schema change, no new env.
- Tested only with fakes: fake interactions/members/channels/clients, `buildApp()` via `app.request` (no socket); real Discord permission resolution with overwrites and the real proxy/IP path were not seen live. Over-redaction trade-off: `token: <word>` in free text is always redacted.

## 2026-10-24 Renovate automerge as PR (block 2, step 1)
- `renovate.json`: `automergeType: "pr"`, `platformAutomerge: false` (was branch automerge + platformAutomerge). Reason: checks run only on `pull_request`, no branch protection / required checks / rulesets exist (`gh api .../branches/main/protection` = 404, no rulesets), so branch automerge had no checks to wait for and GitHub-native auto-merge cannot enforce anything. Now Renovate opens a PR, waits for all checks (`ignoreTests: false`) and merges via API. Automerge: patch/pin/digest and minor of non-0.x; 0.x minors separate PR, majors never. Groups are non-major only. `internalChecksFilter: strict`, `minimumReleaseAge` 3 days for npm, github-actions minor/patch (and pip). `fileMatch` → `managerFilePatterns` (closes Renovate's own migration PR). Locked majors untouched.
- Validated with `npx --package renovate renovate-config-validator --strict --no-global renovate.json` (repo-config mode; catches unknown keys, verified with a broken file). Not seen live: first real automerge run.

## 2026-10-24 Issue routing workflow (block 2, step 2)
- `issue-route.yml` added (see AGENTS.md "Issue routing"). Verified: actionlint + zizmor clean, routing logic tested locally with a stubbed `gh` (keyword, existing-label, needs-triage cases). Escalation call not exercised live (needs a real unclear issue + secrets); no issue was opened to test it.

## 2026-10-24 Drift guard swap (block 2, step 3.1)
- `tools/magguu-drift.py` replaces `tools/drift-check.sh` (adopted from the review draft in `~/security-audit-skill/quality-plan-20261024/`, read in full first). Verified locally: 0 errors on the repo, old script also OK, a tracked file with a forbidden name makes it exit 1 with a GitHub annotation. `quality.yml`: separate `drift` job, no `paths-ignore`.

- 2026-10-24 (block 2, step 3.2): `renovate.json` extends `helpers:pinGitHubActionDigests` (new/updated actions are SHA-pinned automatically). Stale lock rule `satori ~0.41.0` replaced by `<0.48` (satori >=0.48 stays locked; 0.47.x allowed); h3 `<2`, TS `<7`, @types/node `<25` unchanged.

- 2026-10-24 (block 2, step 3.3): docker.yml `build-and-push` has `attestations: write` + step `Attest build provenance` (`actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8` = v4.2.2; subject = image name + build digest; `push-to-registry: false`, `create-storage-record: false`). Cosign keyless signing untouched, no SBOM attest, no `cosign verify` yet. Verify later with `gh attestation verify oci://ghcr.io/derpsen/magguu-bot@<digest> --repo Derpsen/MagguuBot`. docker.yml is in the publish `paths`, so this commit publishes a new image (same content, new digest).

## 2026-10-24 Digest follow-up (review lows on 2d32080)
- Rollback branch `rollback/pre-digest-followup-979e777`. (a) Wiring tests `tests/plex-new-digest-wiring.test.ts` (env -> config via child process incl. invalid day/hour, channel order, day/hour -> manager, `PLEX_NEW_DIGEST_ENABLED=false`, scheduler one 5 min interval + overlap guard + `stopScheduler` clears every handle, idempotent start); seams `plexNewDigestDeps()` / `setPlexNewDigestForTests()`. (b) `plex-card-gateway.test.ts`: real `EmbedBuilder` + discord.js `MessagePayload.resolveBody()` prove `allowed_mentions {parse: []}`, no `content`, embed <= 6000; `cardPostOptions/cardEditOptions/createDiscordCardGateway(resolveChannel)` extracted (behaviour unchanged). (c) `lastRunAt` stays `fetchedAt` (NOT `now`: movie/series caches have different ages, `now` would lose items between snapshot and now); instead `filterRawSince(raw, since, fetchedAt)` adds the upper bound so the next window cannot repeat items. (d) Catch-up until Sunday 23:59 local implemented (see AGENTS "Neu hinzugefügt"): only after a previous run, once per slot via the persisted slot, DST-safe, warn-once, no alarm.
- Residual risks: first-ever digest still strict 15 min; changing `PLEX_NEW_DIGEST_DAY/_HOUR` mid-week can post once for the passed slot (only if a digest ran before); real Discord permissions/live Tautulli still unseen.
- Unraid XML knows `PLEX_WEEKLY_*` and `DISCORD_CHANNEL_PLEX_WEEKLY` and `TRUSTED_PROXIES` already; still missing (optional, left unchanged on purpose): `PLEX_NEW_DIGEST_ENABLED` (true), `PLEX_NEW_DIGEST_DAY` (5), `PLEX_NEW_DIGEST_HOUR` (18), `DISCORD_CHANNEL_NEW_ADDED` (unset -> `newOnPlex` -> `weeklyDigest`), `DISCORD_CHANNEL_BLIZZARD` (unset). No secrets are new.

## 2026-10-24 Welle-f review lows (follow-up to 442a1a2)
- Rollback branch `rollback/pre-lows-7c69ea4`. (1) `scrub.ts`: the quadratic pattern was `USERINFO` only (every `-token-token`/`a.a.a.`-style run, 200 kB > 20 s); `FREETEXT_KEY` measured linear in isolation (the report's `-token` timing was USERINFO re-scanning the scheme charset). Fix: `(?<=\b[a-z][a-z0-9+.-]*)(:\/\/)...@` (look back from `://`), differential fuzz old vs new regex over 400k random strings = 0 differences; plus a hard input cap `MAX_SCRUB_LENGTH` 256 KiB with marker (cut before any pattern, never splits a surrogate). `tests/scrub-perf.test.ts`: 38 pathological 200 kB cases (<3 s each, real code needs ~ms), cap and coverage tests. A reverted USERINFO makes that file hang (sync regex), so CI fails by job timeout instead of by assertion.
- (2) `handleInteraction` exported from `client.ts`, chat-input path in `command-dispatch.ts`, deny path logs `warn { command, reason }`; `tests/command-dispatch.test.ts` (real command map + fake interactions, all guarded commands blocked in DM / empty perms, log has no ids/option values).
- (3) `raid-reminders.ts` `sendChannel` now also fetches the subscriber and requires View + Send (permanent 50013 -> pause once). A member who left is paused too (10007/10013), so ex-members are no longer pinged by channel reminders. Pause notice text for the creator unchanged (`channel_unavailable`).
- (4) NOT changed on purpose: `erinnerung.ts` ~l.124 `ManageGuild` mods can list/delete reminders of higher-ranked members and admins (no hierarchy check; action is non-punitive; audit only as container log `moderatorId/targetId`, not in the mod log, the affected user is not notified).
- (5) `countdown` added to the `EXPECTED` table of `mod-permissions.test.ts`; `clipChoiceText` now counts UTF-16 units (<= 100, emoji = 2) and cuts on grapheme boundaries, new `clipChoiceValue` for choice values; callers with 60/90 limits in `faq.ts` are now stricter for emoji only.

