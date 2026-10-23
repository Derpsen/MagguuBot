# MEMORY.md

Helper memory for MagguuBot. Architecture and CI live in `AGENTS.md`.

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
- Quality (2026-10-16): `.github/workflows/quality.yml` runs `tools/drift-check.sh` (banned addon names outside AGENTS/MEMORY/CHANGELOG/tests, EllesmereUI min 9.0.6 in TOCs, Docker uid 99, engines.node = `${NODE_ENGINE:->=26}`), actionlint 1.7.12 + zizmor 1.31.1 (medium+) + shellcheck + osv-scanner 2.7.0 (downloads sha256-verified). All workflows hardened for zizmor: checkout `persist-credentials: false`, docker.yml packages:write only on build job and no npm cache (package-manager-cache: false).

- 2026-10-23: advisory zizmor workflow `.github/workflows/zizmor.yml` added (zizmor-action v0.8.0 SHA-pinned, non-SARIF, continue-on-error, not required). Findings not fixed yet, pending Buddy review.
- 2026-10-23 (Buddy-approved follow-up): zizmor info `template-injection` fixed (docker.yml Sign image uses step env `IMG` instead of `${{ steps.img.outputs.name }}` in run); stale `# actions/checkout@v7.0.0` comments → `v7.0.1` (SHA unchanged). zizmor now clean.
- 2026-10-23: Reporting an Buddy (ab 2026-10-23): genau eine Done-Meldung pro Auftrag, max. ~800 Zeichen plus Pfad/Commit für Details; Zwischenstände nur bei Aufträgen über 30 Minuten.

## 2026-10-22 Docs drift check

- Adopted `tools/docs-drift.sh` (1:1 from MagguuUI-Website) + `.github/docs-drift-rules.txt` + `docs-drift.yml` (Mon 05:17 UTC + dispatch; issue "Docs-Drift" → Derpsen on hits, closed when clean). No `@health-url` (`/api/status` is Bearer-gated, no public health URL).
- Baseline fix: AGENTS.md no longer names live sha/digests (rule scoped to AGENTS.md). Removed AGENTS lines, kept here as history:

  > - (updated 2026-10-15) Container `MagguuBot` / `ghcr.io/derpsen/magguu-bot`: digest `sha256:07b2cf08a14636e7e4593ab8a6f204efaa545157eff3c2acae75baf0a3ce4b61` (OCI `sha-db54e38` / tip `db54e38`) is the **2026-10-06 baseline (superseded)**. Last recorded Bot image (Notion Tag-Gate note 2026-10-14 ~23:39 Berlin, next to the live Website digest): OCI `sha-69f8d95` / digest `sha256:a5827ffe879da787aa6ff3e3f9012a96815eb7fef7a7e0cbd2d186dbee3ae82f` (includes the 2026-10-14 waves: `/status`, release poller, FAQ auto-answer, `/api/status`). GHCR `:latest` is now `sha-cb706c3` (`sha256:53f13eb5…`, green docker publish of a MEMORY-only commit → no "Unraid & Server" pull needed).
  >
  > - Website live `sha-d8e734a` (digest `sha256:516f6c21…`, 2026-10-14: admin restyle, admin save clears cache, `/admin/content` shows a page list) — superseded: live since 2026-10-14 late evening is `sha-5db94ed` (digest `sha256:abfe0d1d…`, v12.1.8 changelog notes; superseded 2026-10-17 by `sha-6dc9870`, build id `da0941f8`, Node 26); legal notice = "free, non-commercial project operated from Switzerland" + `contact@magguu.xyz` (no name, no address).
