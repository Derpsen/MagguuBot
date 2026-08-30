import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { Colors, truncate } from '../../embeds/colors.js';
import { getRadarrStatus } from '../../services/radarr.js';
import { getSabVersion } from '../../services/sabnzbd.js';
import { getSeerrRequestCount } from '../../services/seerr.js';
import { getSonarrStatus } from '../../services/sonarr.js';
import { resolveAutoRoleTarget } from '../auto-role.js';
import { getChannel, type ChannelKey } from '../channel-store.js';
import type { SlashCommand } from './index.js';

const REQUIRED_CHANNELS: ChannelKey[] = [
  'requests', 'approvals', 'grabs', 'imports', 'failures', 'health', 'weeklyDigest', 'downloadLive', 'movieNight',
];

export const doctorCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('doctor')
    .setDescription('Prüft Konfiguration, Channels, Permissions, Datenbank und Dienste')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.editReply('Nur Administratoren können den Doctor ausführen.');
      return;
    }

    const checks: Array<{ label: string; ok: boolean; detail: string }> = [];
    try {
      db.run(sql`SELECT 1`);
      checks.push({ label: 'SQLite', ok: true, detail: 'erreichbar' });
    } catch {
      checks.push({ label: 'SQLite', ok: false, detail: 'Abfrage fehlgeschlagen' });
    }
    const missingChannels: string[] = [];
    for (const key of REQUIRED_CHANNELS) {
      const id = getChannel(key);
      const channel = id ? await interaction.guild.channels.fetch(id).catch(() => null) : null;
      if (!channel?.isSendable()) missingChannels.push(key);
    }
    checks.push({
      label: 'Channels',
      ok: missingChannels.length === 0,
      detail: missingChannels.length ? `fehlt/nicht sendbar: ${missingChannels.join(', ')}` : 'alle Kernziele sendbar',
    });
    const me = interaction.guild.members.me;
    const requiredPermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ManageRoles,
    ];
    const missingPermissions = requiredPermissions.filter((permission) => !me?.permissions.has(permission));
    checks.push({
      label: 'Bot-Permissions',
      ok: missingPermissions.length === 0,
      detail: missingPermissions.length ? `${missingPermissions.length} Kernrechte fehlen` : 'Kernrechte vorhanden',
    });
    const autoRole = await resolveAutoRoleTarget(interaction.guild);
    checks.push({
      label: 'Startrolle',
      ok: Boolean(autoRole.role && autoRole.assignment?.assignable),
      detail: autoRole.role && autoRole.assignment?.assignable
        ? `„${autoRole.role.name}“ kann vergeben werden${autoRole.warning ? ` · ${autoRole.warning}` : ''}`
        : autoRole.issue ?? 'Keine Startrolle gefunden',
    });
    const intents = interaction.client.options.intents;
    const intentsOk = intents.has(GatewayIntentBits.GuildMembers) && intents.has(GatewayIntentBits.MessageContent);
    checks.push({
      label: 'Gateway Intents',
      ok: intentsOk,
      detail: intentsOk
        ? 'Members + MessageContent vom Bot angefordert (auch im Developer Portal aktivieren)'
        : 'Privileged Intents fehlen',
    });
    const dashboardValues = [config.DISCORD_CLIENT_SECRET, config.SESSION_SECRET, config.ADMIN_USER_IDS, config.DASHBOARD_BASE_URL];
    const dashboardConfigured = dashboardValues.every(Boolean);
    const dashboardPartial = dashboardValues.some(Boolean) && !dashboardConfigured;
    checks.push({ label: 'Dashboard', ok: !dashboardPartial, detail: dashboardConfigured ? 'vollständig konfiguriert' : dashboardPartial ? 'nur teilweise konfiguriert' : 'bewusst deaktiviert' });
    checks.push({ label: 'Frontend-Build', ok: existsSync(resolve('dist-frontend/index.html')), detail: existsSync(resolve('dist-frontend/index.html')) ? 'vorhanden' : 'npm run build ausführen' });

    const services = await Promise.all([
      serviceCheck('Sonarr', Boolean(config.SONARR_URL && config.SONARR_API_KEY), () => getSonarrStatus()),
      serviceCheck('Radarr', Boolean(config.RADARR_URL && config.RADARR_API_KEY), () => getRadarrStatus()),
      serviceCheck('SABnzbd', Boolean(config.SAB_URL && config.SAB_API_KEY), () => getSabVersion()),
      serviceCheck('Seerr', Boolean(config.SEERR_URL && config.SEERR_API_KEY), () => getSeerrRequestCount()),
    ]);
    checks.push(...services);
    const failures = checks.filter((check) => !check.ok).length;
    const lines = checks.map((check) => `${check.ok ? '✅' : '⚠️'} **${check.label}:** ${check.detail}`);
    const embed = new EmbedBuilder()
      .setColor(failures ? Colors.warn : Colors.success)
      .setTitle(failures ? `🩺 Doctor · ${failures} Hinweis(e)` : '🩺 Doctor · alles gesund')
      .setDescription(truncate(lines.join('\n'), 4096))
      .setFooter({ text: 'Hinweise sind nicht automatisch Fehler – deaktivierte optionale Dienste sind okay.' })
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [embed] });
  },
};

async function serviceCheck(
  label: string,
  configured: boolean,
  request: () => Promise<unknown>,
): Promise<{ label: string; ok: boolean; detail: string }> {
  if (!configured) return { label, ok: true, detail: 'optional, nicht konfiguriert' };
  const result = await request().catch(() => null);
  return { label, ok: result !== null, detail: result !== null ? 'erreichbar' : 'konfiguriert, aber nicht erreichbar' };
}
