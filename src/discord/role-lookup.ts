import { canonicalRoleName, roleNameCandidates } from './server-layout.js';

interface NamedRole {
  name: string;
}

interface RoleCacheLike<R extends NamedRole> {
  find(fn: (role: R) => boolean): R | undefined;
}

/**
 * Find a layout role by its new name, falling back to the legacy name it is
 * renamed from (e.g. `ping-extras` → `ping-4k`) so pings and buttons keep
 * working before and after the server rollout.
 */
export function findLayoutRole<R extends NamedRole>(cache: RoleCacheLike<R>, name: string): R | undefined {
  for (const candidate of roleNameCandidates(canonicalRoleName(name))) {
    const role = cache.find((r) => r.name === candidate);
    if (role) return role;
  }
  return undefined;
}
