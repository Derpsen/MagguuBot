export const Colors = {
  brand: 0x7c3aed,
  success: 0x22c55e,
  warn: 0xf59e0b,
  danger: 0xef4444,
  info: 0x3b82f6,
  sonarr: 0x35c5f4,
  radarr: 0xffc230,
  seerr: 0x7c3aed,
  plex: 0xe5a00d,
  sabnzbd: 0xffd100,
  muted: 0x64748b,
} as const;

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0)} ${units[i]}`;
}

export function truncate(s: string | undefined, max = 1024): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
