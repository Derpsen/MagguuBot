# AGENTS.md

## Project Context

MagguuBot is the Discord bot + admin dashboard for the Magguu media homelab
(downloads, Plex activity, moderation, MagguuUI release feed). Full stack,
architecture, and gotchas live in `CLAUDE.md`. Human install docs live in
`README.md`.

## Safe Working Rules

- Read `CLAUDE.md` (and the touched module) before changing behavior.
- Keep changes small and focused. Do not publish unrelated dirty WIP.
- Never commit `.env`, secrets, `data/`, or `dist/`.
- Never expose webhook port 3000 publicly; never skip shared-secret auth.
- MagguuUI FAQ/tag answers that describe the addon must stay in sync with
  current MagguuUI releases/versions.

## Git / publish (Buddy hub)

- Interactive/ad-hoc sessions: do not commit, push, or create git tags unless
  the user explicitly asks for that exact publish step.
- Grok Bot helpers under Buddy's hub standing order: for clear in-scope
  bug/tasks, may commit, push, and merge to main without a per-change ask;
  never force-push; never publish unrelated dirty WIP; report results to Buddy.
- Tags and releases still need an explicit release ask.

## Grok Bot / Buddy

Marco uses Grok Bot “Buddy” as the single front door. Helpers report back to
Buddy. Prefer `CLAUDE.md` for implementation rules.