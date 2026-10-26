# Renovate template for the four Magguu repos

Target state for MagguuUI, MagguuUI-Website, MagguuBot and Magguu-Dashboard (drafted 2026-10-26). Source of truth for the shared part is `renovate.base.json` next to this file. It is the common core of the two live configs (`renovate.json` in MagguuBot and Magguu-Dashboard, identical except for the repo locks and managers listed below) plus one new rule (docker digest group, marked in its description). Copy it to `renovate.json` in the repo root and add that repo's overlay from the table. Nothing here is active until a repo adopts it; this folder changes no repo.

## What the base does

| Topic | Rule |
| --- | --- |
| Schedule | Mondays 00:00-12:59 (Europe/Berlin); lock-file maintenance on the 1st of the month; max 5 open PRs; label `dependencies` (`security` for vulnerability alerts) |
| Grouping | npm minor+patch in one PR ("npm non-major"); GitHub Actions minor/patch/pin/digest in one PR ("github-actions non-major", digest pins via `helpers:pinGitHubActionDigests` stay pinned); Docker digest refreshes in one PR; 0.x minors one PR per package; majors always their own PR |
| Auto-merge | patch, pin, digest, and minor of stable (non-0.x) versions, as a PR that Renovate itself merges only after all checks are green (`automergeType: pr`, `platformAutomerge: false`, `ignoreTests: false`, `internalChecksFilter: strict`). Majors and 0.x minors never |
| Release age | npm and GitHub Actions minor/patch wait 3 days after publish (`minimumReleaseAge`); security fixes (`vulnerabilityAlerts`) and pin/digest refreshes of an already used tag are not delayed |
| Node image | Node majors disabled (manual decision, Node 26 line); digest and minor flow through |

Why PR auto-merge instead of GitHub's auto-merge: it works without branch protection and without the "Allow auto-merge" setting, which MagguuUI cannot have (private free-tier repo, no protection possible; `allow_auto_merge` is off there). Renovate waits for the checks itself.

## Prerequisites (named only, not changed here)

- Renovate GitHub App with access to the repo. MagguuBot and Magguu-Dashboard already have it; MagguuUI and MagguuUI-Website need Marco to add them once in the app's repository access (github.com > Settings > Applications > Renovate > Configure).
- CI must report a stable set of checks on PRs; Renovate treats "no checks" as green. MagguuUI-Website has required status checks on main, MagguuBot and Magguu-Dashboard have no branch protection (the PR auto-merge above does not need it). Branch protection and "Allow auto-merge" are repo settings and stay as they are.
- No other bot may automerge the same PRs (see migration step 5).

## Per-repo overlay (what is not in the base)

| Repo | Today | Overlay after migration |
| --- | --- | --- |
| MagguuBot | Renovate live | `customManagers` regex for the Dockerfile `ARG NODE_DIGEST` (comment `# renovate: image=node:26-alpine` above the ARG lines); locks: `h3` below 2, `satori` below 0.48, `undici` below 8 (tried 2026-10-26 and rolled back: `@discordjs/rest` 2.6.3 uploads fail with the global FormData; revisit with discord.js 15 / `@discordjs/rest` 3) plus `undici` majors off (each override stays in its parent's major: 6 for discord.js, 7 for cheerio) |
| Magguu-Dashboard | Renovate live | `pip_requirements` disabled and `pip-compile` on `requirements-dev.txt`; pip group "pip non-major" (minor/patch, 3 days, majors separate); `h3` and `satori` locks as in the live file (npm tooling) |
| MagguuUI-Website | Dependabot (npm, actions, docker; weekly Monday 05:00/05:15/05:30; 7 day cooldown; groups nuxt-stack, tiptap, test-tooling) | Docker digest manager works as in MagguuBot: its Dockerfile already carries `# renovate: image=node:26-bookworm-slim` above `ARG NODE_VERSION`/`ARG NODE_DIGEST`, so reuse the MagguuBot regex manager (the base image name in the comment is what differs). Locks from the current ignore list: `h3` below 2 (Nuxt 4 / Nitro 2 depend on h3 ^1.15.11; h3 2 comes with Nitro 3, still beta), `satori` below 0.48 (nuxt-og-image 7.0.7 peer is ^0.47.1), `typescript` majors off (typescript-eslint up to 8.72 rejects TS 7). `js-yaml` 5 was released by Marco on 2026-10-26 and is installed (override 5.5.0), so no lock; do not copy a js-yaml lock from older notes. Keep the 7 day age (`minimumReleaseAge: 7 days` for npm and docker) if the Dependabot cooldown should stay, otherwise accept the base 3 days. Optional separate groups equivalent to nuxt-stack/tiptap/test-tooling only if the single "npm non-major" PR proves too large. The `undici` 8.12.3 override is a Website fact, not a lock: no `undici` rule here (the MagguuBot lock does not apply) |
| MagguuUI | Dependabot (github-actions only, weekly Monday 05:00, 7 day cooldown, labels `dependencies`, `github-actions`) | Base minus npm rules (no npm manifest; Lua addon). Only GitHub Actions rules matter; keep SHA pins (`helpers:pinGitHubActionDigests`) and the extra label `github-actions` via `packageRules` if wanted. Keep `minimumReleaseAge: 7 days` for Actions if the old cooldown should stay. No Docker, no locks |

## Dependabot to Renovate migration (MagguuUI-Website and MagguuUI)

Order, one repo at a time, Website first (it has more rules to prove), MagguuUI second:

1. Marco: add the repo to the Renovate app (once, a click). Until the config exists Renovate would open an onboarding PR; so do step 2 first or just merge that PR if it appears.
2. Commit `renovate.json` (base + overlay) to main. Check it with `npx --package renovate renovate-config-validator renovate.json` before pushing.
3. Wait for Renovate's first run (Monday window, or trigger via the Dependency Dashboard checkbox). Compare its PR list with the open Dependabot PRs: same packages, same grouping, locks respected (h3 2, satori 0.48, TS 7 must not appear).
4. Close the open Dependabot PRs that Renovate replaces (do not merge both; a duplicate update can conflict in `package-lock.json`).
5. Remove `.github/dependabot.yml` and the Dependabot auto-merge workflow (`dependabot-automerge.yml` in the Website, `dependabot-auto-merge.yml` in MagguuUI): they only act on PRs by `dependabot[bot]`, so they become dead code, and the Website one checks "Allow auto-merge" plus required status checks, which Renovate does not need. Update AGENTS/MEMORY/README and the `magguu-dependabot` skill text (it assumes Dependabot PRs).
6. Dependabot security updates are a separate repo setting (switched on in the Website 2026-10-23) and keep working without `dependabot.yml`. Decide once: leave it on as a second safety net (duplicate security PRs are possible) or turn it off because `vulnerabilityAlerts` covers it. Not changed by this template.
7. Check after one week: merged PRs, nothing stuck on a missing check, Dependency Dashboard issue open and tidy.

Risks: duplicate PRs while both bots run (steps 3-5 mitigate); the Renovate first run can open many PRs at once (limited by `prConcurrentLimit` 5); the workflow-file edits are visible to zizmor/Scorecard, so keep action refs SHA-pinned; if a check name changes, required status checks on the Website main must be adjusted by Marco (settings, not touched here).

## Keeping it in sync

When a repo's `renovate.json` changes a shared rule, change `renovate.base.json` here in the same commit. Repo locks always carry their reason in `description` and are mirrored in that repo's AGENTS.
