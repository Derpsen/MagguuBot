const REDOS_DENYLIST =
  /(\.\*|\.\+|\w\*|\w\+)\s*[+*]|\(\s*(\.\*|\.\+|\w\*|\w\+)\s*\)[+*]|\([^)]*[+*][^)]*\)[+*]/;

export function parsePositiveId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isSafeRegexPattern(pattern: string): boolean {
  if (REDOS_DENYLIST.test(pattern)) return false;
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}
