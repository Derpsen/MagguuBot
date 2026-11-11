/**
 * MagguuUI release tag for player-facing copy (pinned FAQ card).
 *
 * The live value comes from the existing addon-release announced-tag cache
 * (`addonReleaseAnnouncedTags` in bot_settings, last well-formed tag).
 * When that cache is empty or unreadable, we keep the last shipped known
 * release as a fallback. No extra GitHub call and no new secret.
 *
 * Do not write a `v` + x.y.z token into this module: scripts/check-versions.mjs
 * treats every such literal in src/ as a current-version claim.
 */
const TAG_RE = /^v?(\d+\.\d+\.\d+)$/i;

/** Last shipped known MagguuUI release, without a leading `v`. */
export const FALLBACK_ADDON_VERSION = '12.1.9';

/** Normalise a release tag to `v<major>.<minor>.<patch>`, or null if it is not that shape. */
export function formatAddonVersion(raw: string | null | undefined): string | null {
  const m = raw?.trim().match(TAG_RE);
  return m?.[1] ? `v${m[1]}` : null;
}

/**
 * Prefer the most recently announced well-formed tag; otherwise the shipped fallback.
 * `cachedTags` is oldest-first (the poller appends new tags at the end).
 */
export function resolveAddonVersion(cachedTags: readonly string[] = []): string {
  for (let i = cachedTags.length - 1; i >= 0; i--) {
    const tag = formatAddonVersion(cachedTags[i]);
    if (tag) return tag;
  }
  const fallback = formatAddonVersion(FALLBACK_ADDON_VERSION);
  if (!fallback) throw new Error('FALLBACK_ADDON_VERSION is not a major.minor.patch value');
  return fallback;
}
