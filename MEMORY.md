# MEMORY.md

Helper memory for MagguuBot. Architecture and CI live in `AGENTS.md`.

## 2026-09-10

- Live Unraid container `MagguuBot` / `ghcr.io/derpsen/magguu-bot:latest` after `d095062`.
- `getChannel` caches per process; `saveChannel` updates the Map (setup-server, ticket-buttons, admin).
- `pino-pretty` is `devDependencies` only. `formatBytes` for `/botinfo` comes from `src/embeds/colors.ts`.
- better-sqlite3 is **13** (AGENTS.md).

## MagguuUI product facts (2026-10-05)

- EllesmereUI TOC min **9.0.6+**; live host **9.2.9**; Magguu Ellesmere bake is **dump-based**; release notes reference **v12.1.7** (latest MagguuUI tag).
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
- Merge reports: Actions-only vs App-Image; Homebase pulls after green App-Image docker.
- Pack/copy product-fact deltas: update Bot with Website + Magguu-Dashboard same round.

## 2026-10-05

- Docs/FAQ refresh: Whisper Messenger replaces WIM / Ellesmere WIM Skin in WowUp Optional (FAQ embed + test); bake dump-based; notes v12.1.7; public contact contact@magguu.xyz.

## 2026-10-06 Ops sync (Buddy Inventur)

- #97+#98 merged; Container-Baseline digest `sha256:07b2cf08a14636e7e4593ab8a6f204efaa545157eff3c2acae75baf0a3ce4b61` (OCI `sha-db54e38` / tip `db54e38`) - already live, kein Re-Pull.
- Discord `/setup-server full` Done - embeds **Whisper Messenger**, nicht WIM / Ellesmere WIM Skin.
- Pack-/Author-HARD unveraendert; Optional = Whisper Messenger (WhisperMessenger).
- Prefer Done-Wave Capture after App-Image waves; keine neuen Specialist-Bots.

## 2026-10-12 Facts refresh

- MagguuUI addon live **v12.1.7**.
- Container runs as **uid 99** (entrypoint drops to `PUID=99`/`PGID=100` via su-exec; `PUID=0` keeps root). Images are signed with **Cosign keyless** (GitHub OIDC) in `docker.yml`.
- **WIM is removed** everywhere. Whisper Messenger is the whisper chat in embeds/FAQ. Player button: **Apply Magguu profiles**.
- Node: `engines.node >=24.17`, Node 24 locked. Node 26 only after Marco's yes (~end of Oct 2026).

## 2026-10-12 Docs/Bots-Sync

- Helpers renamed (IDs unchanged): Botsmith = MagguuBot + Magguu-Dashboard; Webcraft = MagguuUI-Website only; Luaforge = addon Lua; Sentinel = review; Launchpad = releases/Tag-Gate; Homebase = Unraid; Captain = Notion; Buddy = front door. Old names: Stack Fixer/Stack, Bot Fixer, Addon Fixer, Reviewer, Release Helfer, Homelab Helfer, Projects Manager.
- Rooms: Addon HQ, Web Studio, Bot Lab, Dashboard Deck, Homebase Ops.
- Buddy makes small MagguuUI-Website design/text changes directly; bigger work goes to the helpers. Since 2026-10-12 helpers and Buddy push directly to `main` (no PRs, no Sentinel pre-review); Buddy reviews commits afterwards; Homebase pulls autonomously after green Docker publish.
- Addon live v12.1.7. "Split names" options are becoming "Two-tone unit-frame names" / "Two-tone party and raid names" (MagguuUI PR #30; `SPLIT_NAMES` keys unchanged): half the name in the default color, half in the class color.
- Website live `sha-d8e734a` (digest `sha256:516f6c21…`, 2026-10-14: admin restyle, admin save clears cache, `/admin/content` shows a page list); legal notice = "free, non-commercial project operated from Switzerland" + `contact@magguu.xyz` (no name, no address).
- Unchanged: WIM removed, Whisper Messenger used; "Apply Magguu profiles"; Node 26 needs Marco's yes; locked TS 7, h3 2, @types/node 26; uid 99 + Cosign; `engines.node >=24.17`; no tags without Marco's yes; never remove third-party author names.

## 2026-10-14 Botsmith wave

- `/status` (utility, ephemeral): uptime, image version from `MAGGUU_BUILD_SHA`/`MAGGUU_BUILD_DATE` (Dockerfile ENV from `VCS_REF`/`BUILD_DATE` build-args, set in `docker.yml` to `github.sha` + OCI created; falls back to "unbekannt"), last webhook per source (Sonarr, Radarr, Seerr, Tautulli, SABnzbd, Prowlarr, Maintainerr, GitHub) via `MAX(created_at)` on `webhook_events` (no new table; replay rows excluded). Warning when silent > `STATUS_STALE_HOURS` (default 24). Builder in `src/embeds/status.ts`, tests in `tests/status.test.ts`.
- CI: `ci.yml` matrix Node 24 (required) + Node 26 (`continue-on-error`, full `npm ci` + better-sqlite3/@napi-rs/canvas smoke). No engines/package bump; Node 24 stays locked.
- `scripts/check-versions.mjs` + `version-check.yml` (daily + dispatch): truth = latest MagguuUI release tag (TOC `## Version` is `@project-version@`); Bot mismatches fail, Website mismatches only warn. MagguuUI is private: needs secret `MAGGUUUI_READ_TOKEN`, otherwise the job only warns.
- Helper rename finished (Captain, Homebase); pipeline push-to-main, Buddy reviews afterwards, Homebase pulls after green Docker publish.

## 2026-10-14 Botsmith wave 2

- **MagguuUI release poller** (`src/discord/addon-release-poller.ts`): polls `releases/latest` of `MAGGUUUI_RELEASE_REPO` (default Derpsen/MagguuUI, private) every `ADDON_RELEASE_POLL_MINUTES` (15) with `MAGGUUUI_READ_TOKEN`; off without token. Posts to `addonUpdates` (fallback `github`). Announced tags persist in `bot_settings` key `addonReleaseAnnouncedTags`; empty store = seed with current latest (no historical post). Shared with the GitHub release webhook, so poll + webhook never double-post. Drafts/prereleases skipped. Never creates tags.
- Release embed (`src/embeds/addon-release.ts`): deterministic summary of the newest version block of the release body, markdown stripped, headings Große Neuerungen / Weitere Features / Bugfixes, top 3 bullets each (+ "… und N weitere"), link to the full release; field ≤1024, description ≤4096.
- **Website FAQ auto-answer** (`src/discord/faq-autoanswer.ts`, matcher `src/utils/faq-matcher.ts`): source `GET https://ui.magguu.xyz/api/v1/faqs` (public, grouped by category), hourly cache. Only in `FAQ_AUTOANSWER_CHANNEL_IDS` (empty = off), only question-like messages, conservative token-overlap score (`FAQ_AUTOANSWER_MIN_SCORE` 0.6, ≥2 shared tokens, clear lead over runner-up), per-user 300 s / per-channel 60 s cooldowns, same FAQ not repeated per channel within 360 min; otherwise silent. MessageContent intent is already requested in code (`client.ts`); must stay enabled in the Developer Portal.
- `GET /api/status` (read-only JSON: uptime, build SHA/date, last webhook per source; no secrets) – disabled unless `STATUS_API_TOKEN` is set, then requires `Authorization: Bearer`. Used by the Magguu-Dashboard „Magguu-Dienste“ view.
- Renovate replaces Dependabot (`renovate.json`, `.github/dependabot.yml` removed; Node <26, @types/node <25, TS <7, h3 <2, satori ~0.41). Renovate GitHub App not installed yet – Marco/Buddy must install. `dependabot-auto-merge.yml` kept for Dependabot security PRs.
- Homebase: add to the Unraid template `MAGGUUUI_READ_TOKEN` (masked), `STATUS_API_TOKEN` (masked), `FAQ_AUTOANSWER_CHANNEL_IDS`; optional `ADDON_RELEASE_POLL_MINUTES`.
