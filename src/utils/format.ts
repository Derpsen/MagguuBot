/** Shared leaf formatters (no Discord/DB imports). Cached Intl where hot paths call often. */

const deNumber = new Intl.NumberFormat('de-DE');

/** Seconds → compact uptime (`3d 2h 5m` / `2h 5m` / `5m`). */
export function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** `YYYY-MM-DD` → `DD.MM.YYYY`; unknown shape returned unchanged. */
export function germanDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return y && m && d ? `${d}.${m}.${y}` : isoDate;
}

/** Integer/float with German grouping (cached formatter). */
export function formatDeNumber(n: number): string {
  return deNumber.format(n);
}
