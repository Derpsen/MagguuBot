// A non-empty sentinel distinguishes an explicit dashboard choice of the
// conventional @Newcomer role from "no database override, use AUTO_ROLE_ID".
// Bot settings historically treat empty strings as absent environment fallbacks.
export const NEWCOMER_ROLE_SENTINEL = '__magguu_newcomer__';

export function parseAutoRoleSetting(raw: string): string | null {
  return raw === NEWCOMER_ROLE_SENTINEL || raw === '' ? null : raw;
}

export function serializeAutoRoleSetting(value: string | null): string {
  return value ?? NEWCOMER_ROLE_SENTINEL;
}
