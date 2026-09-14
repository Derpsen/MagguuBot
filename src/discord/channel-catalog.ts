/** Dashboard labels + persistent channel keys. ChannelKey is derived from this list. */
export const CHANNEL_CATALOG = [
  { key: 'grabs', label: 'Grabs', description: 'Sonarr/Radarr Grabs' },
  { key: 'imports', label: 'Imports', description: 'Erfolgreiche Imports' },
  { key: 'failures', label: 'Failures', description: 'Fehlerhafte Downloads' },
  { key: 'requests', label: 'Requests', description: 'Seerr Approved/Declined' },
  { key: 'approvals', label: 'Approvals', description: 'Seerr Pending mit Approve/Decline' },
  { key: 'newOnPlex', label: 'New on Plex', description: 'Tautulli recently_added' },
  { key: 'health', label: 'Health', description: 'Sonarr/Radarr/Prowlarr Health Warnings' },
  { key: 'welcome', label: 'Welcome', description: 'Member-Join Welcome' },
  { key: 'auditLog', label: 'Audit Log', description: 'Joins/Leaves/Role-Changes' },
  { key: 'modLog', label: 'Mod Log', description: 'Moderation Actions' },
  { key: 'github', label: 'GitHub', description: 'GitHub Webhook Feed' },
  { key: 'starboard', label: 'Starboard', description: '⭐ Highlights' },
  { key: 'plexActivity', label: 'Plex Activity', description: 'Tautulli Playback Events' },
  { key: 'maintainerr', label: 'Maintainerr', description: 'Maintainerr Cleanup Events' },
  { key: 'blueTracker', label: 'Blue Tracker', description: 'WoW Blue-Tracker RSS' },
  { key: 'addonUpdates', label: 'Addon Updates', description: 'GitHub Addon-Repo Feed' },
  { key: 'faq', label: 'FAQ', description: 'FAQ Channel' },
  { key: 'suggestions', label: 'Suggestions', description: 'Community Suggestions' },
  { key: 'ticketLogs', label: 'Ticket Logs', description: 'Ticket Close/Transcript Logs' },
  { key: 'weeklyDigest', label: 'Wochenrückblick', description: 'Automatischer Wochen-Digest' },
  { key: 'downloadLive', label: 'Live Downloads', description: 'Aktualisierte Queue-Karte' },
  { key: 'movieNight', label: 'Movie Night', description: 'Nominierungen und Abstimmungen' },
] as const;

export type ChannelKey = (typeof CHANNEL_CATALOG)[number]['key'];

const CHANNEL_KEY_SET: ReadonlySet<string> = new Set(CHANNEL_CATALOG.map((entry) => entry.key));

export function isChannelKey(value: string): value is ChannelKey {
  return CHANNEL_KEY_SET.has(value);
}