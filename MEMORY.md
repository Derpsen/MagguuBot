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
- Merge reports: Actions-only vs App-Image; Homelab pulls after green App-Image docker.
- Pack/copy product-fact deltas: update Bot with Website + Magguu-Dashboard same round.

## 2026-10-05

- Docs/FAQ refresh: Whisper Messenger replaces WIM / Ellesmere WIM Skin in WowUp Optional (FAQ embed + test); bake dump-based; notes v12.1.7; public contact contact@magguu.xyz.

## 2026-10-06 Ops sync (Buddy Inventur)

- #97+#98 merged; Container-Baseline digest `sha256:07b2cf08a14636e7e4593ab8a6f204efaa545157eff3c2acae75baf0a3ce4b61` (OCI `sha-db54e38` / tip `db54e38`) - already live, kein Re-Pull.
- Discord `/setup-server full` Done - embeds **Whisper Messenger**, nicht WIM / Ellesmere WIM Skin.
- Pack-/Author-HARD unveraendert; Optional = Whisper Messenger (WhisperMessenger).
- Prefer Done-Wave Capture after App-Image waves; keine neuen Specialist-Bots.
