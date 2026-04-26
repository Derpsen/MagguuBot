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
  tautulli: 0xfa8500,
  github: 0x24292f,
  maintainerr: 0xa855f7,
  blueTracker: 0x148ae3,
  suggestion: 0x06b6d4,
  muted: 0x64748b,
} as const;

const FOOTER_ICONS: Record<string, string> = {
  sonarr: 'https://raw.githubusercontent.com/Sonarr/Sonarr/develop/Logo/256.png',
  radarr: 'https://raw.githubusercontent.com/Radarr/Radarr/develop/Logo/256.png',
  seerr: 'https://raw.githubusercontent.com/sct/overseerr/develop/public/android-chrome-512x512.png',
  plex: 'https://www.plex.tv/wp-content/themes/plex/assets/img/favicons/plex-180.png',
  sabnzbd: 'https://raw.githubusercontent.com/sabnzbd/sabnzbd/master/icons/logo-arrow.svg',
  tautulli: 'https://raw.githubusercontent.com/Tautulli/Tautulli/master/data/interfaces/default/images/logo-circle.png',
  github: 'https://github.githubassets.com/favicons/favicon-dark.png',
  maintainerr: 'https://raw.githubusercontent.com/jorenn92/Maintainerr/main/docs/assets/logo.png',
  bot: 'https://raw.githubusercontent.com/walkxcode/dashboard-icons/main/png/discord.png',
};

export interface FooterOptions {
  source?: keyof typeof FOOTER_ICONS;
  text?: string;
}

export function buildFooter(opts: FooterOptions = {}): { text: string; iconURL?: string } {
  const text = opts.text ?? 'MagguuBot';
  const iconURL = opts.source ? FOOTER_ICONS[opts.source] : FOOTER_ICONS.bot;
  return { text, iconURL };
}

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
