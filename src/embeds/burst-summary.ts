import { EmbedBuilder } from 'discord.js';
import { Colors, truncate } from './colors.js';

export type BurstKind = 'deletes' | 'imports' | 'grabs' | 'newOnPlex';

export interface BurstItem {
  service: string;
  title: string;
}

const META: Record<BurstKind, { icon: string; label: string; footer: string }> = {
  deletes: { icon: '🗑️', label: 'Library-Löschungen', footer: 'Library-Löschungen gebündelt' },
  imports: { icon: '📥', label: 'Imports', footer: 'Imports gebündelt' },
  grabs: { icon: '⬇️', label: 'Grabs', footer: 'Grabs gebündelt' },
  newOnPlex: { icon: '✨', label: 'neu auf Plex', footer: 'Neu auf Plex gebündelt' },
};

/** Footer text of a summary card (`MagguuBot · …`), used by routing/acceptance to recognise it. */
export const BURST_FOOTERS: Record<BurstKind, string> = Object.fromEntries(
  Object.entries(META).map(([k, m]) => [k, `MagguuBot · ${m.footer}`]),
) as Record<BurstKind, string>;

const MAX_LINES = 20;

/** One card for a whole burst: count per service and a truncated title list (×n for repeats). */
export function buildBurstSummaryEmbed(kind: BurstKind, items: readonly BurstItem[]): EmbedBuilder {
  const m = META[kind];
  const perService = new Map<string, number>();
  const perTitle = new Map<string, number>();
  for (const i of items) {
    perService.set(i.service, (perService.get(i.service) ?? 0) + 1);
    perTitle.set(i.title, (perTitle.get(i.title) ?? 0) + 1);
  }
  const services = [...perService].map(([s, n]) => `${s} ${n}`).join(', ');
  const titles = [...perTitle].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lines = titles.slice(0, MAX_LINES).map(([t, n]) => `• ${truncate(t, 80)}${n > 1 ? ` ×${n}` : ''}`);
  if (titles.length > MAX_LINES) lines.push(`… und ${titles.length - MAX_LINES} weitere Titel`);
  return new EmbedBuilder()
    .setColor(kind === 'deletes' ? Colors.muted : Colors.info)
    .setTitle(truncate(`${m.icon}  ${items.length} ${m.label} (${services})`, 256))
    .setDescription(truncate(lines.join('\n'), 4000))
    .setTimestamp(new Date())
    .setFooter({ text: BURST_FOOTERS[kind] });
}
