import { EmbedBuilder } from 'discord.js';
import { Colors, buildFooter, truncate } from './colors.js';
import type { TautulliSession } from '../services/tautulli.js';

const STATE_EMOJI: Record<string, string> = {
  playing: '▶️',
  paused: '⏸️',
  buffering: '🔄',
};

const MEDIA_EMOJI: Record<string, string> = {
  movie: '🎬',
  episode: '📺',
  track: '🎵',
  clip: '🎞️',
};

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0:00';
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function progressBar(percent: number, width = 14): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clamped / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${clamped}%`;
}

function formatBandwidth(kbps: number): string | null {
  if (!kbps || kbps <= 0) return null;
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${kbps} kbps`;
}

export function buildPlexNowPlayingEmbed(sessions: TautulliSession[]): EmbedBuilder {
  if (sessions.length === 0) {
    return new EmbedBuilder()
      .setColor(Colors.muted)
      .setTitle('🎞️ Plex — Aktuell läuft nichts')
      .setDescription('Keine aktiven Streams gerade.')
      .setTimestamp(new Date())
      .setFooter(buildFooter({ source: 'plex' }));
  }

  const transcodeCount = sessions.filter((s) => s.decision === 'transcode').length;
  const totalBandwidthKbps = sessions.reduce((sum, s) => sum + s.bandwidthKbps, 0);

  const headline = `${sessions.length} Stream${sessions.length === 1 ? '' : 's'}` +
    (transcodeCount > 0 ? ` · ${transcodeCount} transcode${transcodeCount === 1 ? '' : 's'}` : '') +
    (totalBandwidthKbps > 0 ? ` · ${formatBandwidth(totalBandwidthKbps)}` : '');

  const embed = new EmbedBuilder()
    .setColor(Colors.plex)
    .setTitle(`🎞️ Plex — Now Playing`)
    .setDescription(headline)
    .setTimestamp(new Date())
    .setFooter(buildFooter({ source: 'plex' }));

  for (const s of sessions.slice(0, 10)) {
    const stateEmoji = STATE_EMOJI[s.state] ?? '🔵';
    const mediaEmoji = MEDIA_EMOJI[s.mediaType] ?? '🎬';
    const decision = s.decision === 'transcode'
      ? `🔄 Transcode${s.resolution ? ` → ${s.resolution}` : ''}`
      : s.decision === 'direct play'
        ? '⚡ Direct Play'
        : s.decision === 'copy'
          ? '📡 Direct Stream'
          : null;

    const lines = [
      `${mediaEmoji} ${truncate(s.title, 200)}`,
      `${stateEmoji} **${s.user}** · ${truncate(s.player, 80)}`,
      progressBar(s.progressPercent),
      `${formatDuration(s.progressMs)} / ${formatDuration(s.durationMs)}`,
    ];
    if (decision) lines.push(decision);

    embed.addFields({
      name: `​`,
      value: lines.join('\n'),
      inline: false,
    });
  }

  if (sessions.length > 10) {
    embed.addFields({
      name: '​',
      value: `… und ${sessions.length - 10} weitere`,
      inline: false,
    });
  }

  return embed;
}
