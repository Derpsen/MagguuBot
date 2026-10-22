/**
 * Single source for the admin sidebar (8 entries in 4 sections) and for the
 * legacy routes that now live as tabs inside a hub page. Legacy paths stay
 * reachable as redirects so bookmarks and older links keep working.
 */
export interface NavEntry {
  name: string;
  label: string;
  to: string;
  icon: NavIconKey;
}

export interface NavSectionDef {
  title: string;
  items: NavEntry[];
}

export type NavIconKey =
  | 'overview'
  | 'requests'
  | 'webhooks'
  | 'moderation'
  | 'content'
  | 'members'
  | 'channels'
  | 'settings';

export const NAV_SECTIONS: NavSectionDef[] = [
  {
    title: 'Übersicht',
    items: [{ name: 'dashboard', label: 'Übersicht', to: '/', icon: 'overview' }],
  },
  {
    title: 'Media',
    items: [
      { name: 'requests', label: 'Anfragen', to: '/requests', icon: 'requests' },
      { name: 'webhooks', label: 'Webhooks', to: '/webhooks', icon: 'webhooks' },
    ],
  },
  {
    title: 'Community',
    items: [
      { name: 'moderation', label: 'Moderation', to: '/moderation', icon: 'moderation' },
      { name: 'content', label: 'Inhalte', to: '/content', icon: 'content' },
      { name: 'members', label: 'Mitglieder', to: '/members', icon: 'members' },
    ],
  },
  {
    title: 'System',
    items: [
      { name: 'channels', label: 'Kanäle', to: '/channels', icon: 'channels' },
      { name: 'settings', label: 'Einstellungen', to: '/settings', icon: 'settings' },
    ],
  },
];

export interface HubTab {
  key: string;
  label: string;
}

export const HUB_TABS = {
  moderation: [
    { key: 'warnings', label: 'Verwarnungen' },
    { key: 'tickets', label: 'Tickets' },
    { key: 'audit-log', label: 'Audit-Log' },
  ],
  content: [
    { key: 'tags', label: 'Tags' },
    { key: 'autoresponders', label: 'Auto-Antworten' },
    { key: 'scheduled', label: 'Geplante Beiträge' },
    { key: 'role-panels', label: 'Rollen-Panels' },
  ],
  members: [
    { key: 'xp', label: 'XP' },
    { key: 'reputation', label: 'Reputation' },
    { key: 'reminders', label: 'Erinnerungen' },
  ],
  channels: [
    { key: 'mapping', label: 'Zuordnung' },
    { key: 'rss', label: 'RSS-Feeds' },
    { key: 'faq', label: 'FAQ-Autoantwort' },
  ],
} as const satisfies Record<string, readonly HubTab[]>;

export type HubName = keyof typeof HUB_TABS;

/** Former sidebar paths → new home (hub path + tab). */
export const LEGACY_REDIRECTS: ReadonlyArray<{ from: string; hub: HubName; tab: string }> = [
  { from: '/warnings', hub: 'moderation', tab: 'warnings' },
  { from: '/tickets', hub: 'moderation', tab: 'tickets' },
  { from: '/tags', hub: 'content', tab: 'tags' },
  { from: '/autoresponders', hub: 'content', tab: 'autoresponders' },
  { from: '/scheduled', hub: 'content', tab: 'scheduled' },
  { from: '/role-panels', hub: 'content', tab: 'role-panels' },
  { from: '/leaderboard', hub: 'members', tab: 'xp' },
  { from: '/reputation', hub: 'members', tab: 'reputation' },
  { from: '/reminders', hub: 'members', tab: 'reminders' },
  { from: '/rss', hub: 'channels', tab: 'rss' },
];
