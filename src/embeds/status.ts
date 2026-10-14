import { EmbedBuilder } from 'discord.js';
import { Colors, truncate } from './colors.js';

export const STATUS_WEBHOOK_SOURCES = [
  'sonarr',
  'radarr',
  'seerr',
  'tautulli',
  'sabnzbd',
  'prowlarr',
  'maintainerr',
  'github',
] as const;

const SOURCE_LABELS: Record<(typeof STATUS_WEBHOOK_SOURCES)[number], string> = {
  sonarr: 'Sonarr',
  radarr: 'Radarr',
  seerr: 'Seerr',
  tautulli: 'Tautulli',
  sabnzbd: 'SABnzbd',
  prowlarr: 'Prowlarr',
  maintainerr: 'Maintainerr',
  github: 'GitHub',
};

export interface BuildInfo {
  sha: string | null;
  date: string | null;
}

export interface StatusInput {
  uptimeSeconds: number;
  build: BuildInfo;
  lastWebhookAt: ReadonlyMap<string, Date>;
  staleHours: number;
  now: Date;
}

export type SourceState = 'ok' | 'stale' | 'never';

const UNKNOWN_REFS = new Set(['', 'unknown', 'dev']);

export function readBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  const rawSha = (env.MAGGUU_BUILD_SHA ?? env.GIT_SHA ?? env.SOURCE_COMMIT ?? '').trim();
  const rawDate = (env.MAGGUU_BUILD_DATE ?? '').trim();
  return {
    sha: UNKNOWN_REFS.has(rawSha) ? null : rawSha,
    date: UNKNOWN_REFS.has(rawDate) ? null : rawDate,
  };
}

export function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatAge(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ${min % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function sourceState(last: Date | undefined, staleHours: number, now: Date): SourceState {
  if (!last) return 'never';
  return now.getTime() - last.getTime() > staleHours * 3_600_000 ? 'stale' : 'ok';
}

export function buildStatusEmbed(input: StatusInput): EmbedBuilder {
  const { build, lastWebhookAt, staleHours, now } = input;
  const version = build.sha
    ? `\`sha-${build.sha.slice(0, 7)}\`${build.date ? `\nBuild: ${build.date}` : ''}`
    : 'unbekannt (kein Build-SHA, lokaler Build?)';

  const lines: string[] = [];
  let warnings = 0;
  for (const source of STATUS_WEBHOOK_SOURCES) {
    const last = lastWebhookAt.get(source);
    const state = sourceState(last, staleHours, now);
    const label = SOURCE_LABELS[source];
    if (state === 'ok' && last) {
      lines.push(`✅ ${label}: vor ${formatAge(now.getTime() - last.getTime())}`);
    } else if (state === 'stale' && last) {
      warnings++;
      lines.push(`⚠️ ${label}: vor ${formatAge(now.getTime() - last.getTime())} (still > ${staleHours}h)`);
    } else {
      warnings++;
      lines.push(`⚠️ ${label}: noch nie empfangen`);
    }
  }

  return new EmbedBuilder()
    .setColor(warnings > 0 ? Colors.warn : Colors.success)
    .setTitle('MagguuBot Status')
    .addFields(
      { name: 'Uptime', value: formatUptime(input.uptimeSeconds), inline: true },
      { name: 'Version', value: truncate(version, 1024), inline: true },
      { name: `Letzter Webhook (Warnung nach ${staleHours}h)`, value: truncate(lines.join('\n'), 1024) },
    )
    .setFooter({ text: warnings > 0 ? `${warnings} Quelle(n) mit Warnung` : 'Alle Quellen aktiv' })
    .setTimestamp(now);
}

export interface StatusSnapshot {
  ok: boolean;
  uptimeSeconds: number;
  build: BuildInfo;
  staleHours: number;
  webhooks: Record<string, { lastReceivedAt: string | null; state: SourceState }>;
  generatedAt: string;
}

export function buildStatusSnapshot(
  input: { uptimeSeconds: number; build: BuildInfo; lastWebhookAt: ReadonlyMap<string, Date>; staleHours: number; now: Date },
): StatusSnapshot {
  const webhooks: StatusSnapshot['webhooks'] = {};
  for (const source of STATUS_WEBHOOK_SOURCES) {
    const last = input.lastWebhookAt.get(source);
    webhooks[source] = { lastReceivedAt: last?.toISOString() ?? null, state: sourceState(last, input.staleHours, input.now) };
  }
  return {
    ok: true,
    uptimeSeconds: Math.floor(input.uptimeSeconds),
    build: input.build,
    staleHours: input.staleHours,
    webhooks,
    generatedAt: input.now.toISOString(),
  };
}

