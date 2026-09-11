# MEMORY.md

Helper memory for MagguuBot. Architecture and CI live in `AGENTS.md`.

## 2026-09-10

- Live Unraid container `MagguuBot` / `ghcr.io/derpsen/magguu-bot:latest` after `d095062`.
- `getChannel` caches per process; `saveChannel` updates the Map (setup-server, ticket-buttons, admin).
- `pino-pretty` is `devDependencies` only. `formatBytes` for `/botinfo` comes from `src/embeds/colors.ts`.
- better-sqlite3 is **13** (AGENTS.md).

## MagguuUI product facts (2026-09-07)

- EllesmereUI TOC min **9.0.6+**; live host **9.1.6**; Magguu Ellesmere bake **9.0.8**.
- Four sibling AddOns: MagguuUI / MagguuUI_Data / MagguuUI_EUI / MagguuUI_Media (all enabled).
- Gold **Magguu-Profile übernehmen** (EN: Apply Magguu profiles) = bake + Magguu Settings + companions (including dump addons). **Magguu Settings** = overlay/QoL/fonts/scale/chat only (no bake reimport). **Load profiles** = activate Magguu profiles (including dump addons); no bake reimport except a missing dump once; class layouts per character. Setup buttons: BigWigs, Northern Sky, EXBoss only.
- Ellesmere bake is **delta-only** (feature/schema merge; no blind profile replace). Fresh / new bake deltas need Magguu-Profile übernehmen.
- **Targeted Spell Bars** (Ellesmere Nearby Cast / Mythic+ Tools) ON via Magguu-Profile übernehmen; keep **EXBoss MythicCast OFF** (same job — do not run both).
- MagguuUI_EUI: **Boiling Point** kept. **TopBar / Hearth-Picker / Magguu FPS-MS removed** — no FAQ promises for them. AuraBuff bag/group **count CENTER**.
- Hide Services: secret-safe Services/Dienste strip on General only; never bare channel index 5; do not swallow fight chat.
- Bot copy/docs/AGENTS/MEMORY: person names only **Magguu** / **MagguuUI**. Scrub foreign author/person credits. Keep addon **product** names (EllesmereUI, BigWigs, EXBoss, …). Never set Magguu as author of a foreign addon.
- FAQ/welcome embeds must not name foreign authors (enforced in `tests/features.test.ts`). Discord field values ≤ 1024 chars.
- Store listings (CurseForge / Wago / WoWI) are MagguuUI `docs/store-descriptions/`. WoWI logo is GitHub raw `logo-300.png`, not `ui.magguu.xyz`.

## WowUp packs (2026-09-06)

- **Starter:** EllesmereUI, MagguuUI, BigWigs, LittleWigs, Northern Sky, EXBoss, EXCore.
- **Optional:** BugGrabber, BugSack, HandyNotes, MDT, Raider.IO, Simulationcraft, Talent Tree Tweaks, WIM, Ellesmere WIM Skin, Waypoint UI, GTFO, Premade Groups Filter, Auctionator.
- No WindTools. No KeystoneLoot / Archon-BiS / KSL-BiS in user-facing copy or Optional pack; never MagguuKSL; never name Devourer as a special include. Skinning DualRow has no EXBoss split names.