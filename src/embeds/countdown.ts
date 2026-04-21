import { EmbedBuilder } from 'discord.js';
import { Colors, truncate } from './colors.js';

export interface CountdownState {
  title: string;
  description: string | null;
  targetAt: Date;
  finished: boolean;
}

export function buildCountdownEmbed(s: CountdownState): EmbedBuilder {
  const now = Date.now();
  const msLeft = s.targetAt.getTime() - now;
  const passed = msLeft <= 0;

  const e = new EmbedBuilder()
    .setColor(passed ? Colors.success : Colors.brand)
    .setAuthor({ name: passed ? 'Countdown  ·  abgelaufen' : 'Countdown  ·  läuft' })
    .setTitle(`⏳  ${truncate(s.title, 200)}`)
    .setTimestamp(s.targetAt);

  if (s.description) e.setDescription(truncate(s.description, 2000));

  const unix = Math.floor(s.targetAt.getTime() / 1000);
  if (passed) {
    e.addFields(
      { name: 'Status', value: '🎉 **Jetzt!**', inline: true },
      { name: 'Wann', value: `<t:${unix}:F>`, inline: true },
    );
    e.setFooter({ text: 'MagguuBot  ·  Event gestartet' });
  } else {
    const label = renderTimeLeft(msLeft);
    e.addFields(
      { name: 'Verbleibend', value: `\`${label}\``, inline: true },
      { name: 'Datum', value: `<t:${unix}:F>\n<t:${unix}:R>`, inline: true },
    );
    e.setFooter({ text: 'MagguuBot  ·  auto-update alle ~5 Min' });
  }

  return e;
}

export function renderTimeLeft(msLeft: number): string {
  if (msLeft <= 0) return '0s';
  const totalSec = Math.floor(msLeft / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);

  if (d >= 2) return `${d}d ${h}h`;
  if (d === 1) return `1d ${h}h ${m}m`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}
