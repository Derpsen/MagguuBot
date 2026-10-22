import { EmbedBuilder } from 'discord.js';
import { Colors, truncate, FOOTER_ICONS } from './colors.js';

export const SUMMARY_HEADINGS = ['Große Neuerungen', 'Weitere Features', 'Bugfixes'] as const;
const MAX_BULLETS = 3;
const MAX_BULLET_CHARS = 220;
const VERSION_HEADING = /^#{1,3}\s+v?\d+\.\d+(?:\.\d+)*\b/;

export interface ReleaseSummarySection {
  heading: (typeof SUMMARY_HEADINGS)[number];
  bullets: string[];
  omitted: number;
}

export interface ReleaseSummary {
  intro: string;
  sections: ReleaseSummarySection[];
}

export function stripMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Release bodies carry the whole changelog; only the newest version block is summarized.
function newestVersionBlock(lines: string[]): string[] {
  const start = lines.findIndex((l) => VERSION_HEADING.test(l.trim()));
  if (start === -1) return lines;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => VERSION_HEADING.test(l.trim()));
  return end === -1 ? rest : rest.slice(0, end);
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function summarizeReleaseNotes(body: string | null | undefined): ReleaseSummary {
  const lines = newestVersionBlock((body ?? '').replace(/\r\n/g, '\n').split('\n'));
  const buckets = new Map<string, string[]>();
  const introParts: string[] = [];
  let current: string | null = null;
  let seenHeading = false;

  for (const raw of lines) {
    const line = raw.trim();
    const heading = line.match(/^#{2,6}\s+(.+)$/);
    if (heading) {
      seenHeading = true;
      const name = stripMarkdown(heading[1] ?? '').toLowerCase();
      current = SUMMARY_HEADINGS.find((h) => h.toLowerCase() === name) ?? null;
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet && current) {
      const text = stripMarkdown(bullet[1] ?? '');
      if (text) buckets.set(current, [...(buckets.get(current) ?? []), text]);
      continue;
    }
    if (!seenHeading && line && !line.startsWith('#') && line !== '---') introParts.push(stripMarkdown(line));
  }

  const sections: ReleaseSummarySection[] = [];
  for (const heading of SUMMARY_HEADINGS) {
    const all = buckets.get(heading) ?? [];
    if (all.length === 0) continue;
    sections.push({
      heading,
      bullets: all.slice(0, MAX_BULLETS).map((b) => shorten(b, MAX_BULLET_CHARS)),
      omitted: Math.max(0, all.length - MAX_BULLETS),
    });
  }
  return { intro: shorten(introParts.join(' '), 600), sections };
}

export interface AddonReleaseInput {
  tag: string;
  name?: string | null;
  body?: string | null;
  url: string;
}

export function buildAddonReleaseAnnouncementEmbed(i: AddonReleaseInput): EmbedBuilder {
  const summary = summarizeReleaseNotes(i.body);
  const description = [
    summary.intro,
    summary.sections.length === 0 ? 'Details stehen in den vollständigen Release-Notes.' : '',
    `Vollständige Release-Notes: ${i.url}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(Colors.brand)
    .setAuthor({ name: 'MagguuUI', url: 'https://ui.magguu.xyz' })
    .setTitle(`🎨  MagguuUI ${i.tag} ist verfügbar`)
    .setURL(i.url)
    .setDescription(truncate(description, 4096))
    .setFooter({ text: 'MagguuUI  ·  neues Release', iconURL: FOOTER_ICONS.bot })
    .setTimestamp(new Date());

  for (const s of summary.sections) {
    const lines = s.bullets.map((b) => `• ${b}`);
    if (s.omitted > 0) lines.push(`… und ${s.omitted} weitere`);
    embed.addFields({ name: s.heading, value: truncate(lines.join('\n'), 1024) });
  }
  return embed;
}
