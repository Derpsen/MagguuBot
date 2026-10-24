import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import {
  RIO_REGIONS,
  checkScoreRole,
  normaliseRioInput,
  parseRioThresholds,
  scoreRoleRefusal,
  type RioTier,
} from '../../utils/rio-roles.js';
import {
  RIO_NOT_CONFIGURED_MESSAGE,
  endRio,
  getRioSeasonLabel,
  getRioTiers,
  linkRioCharacter,
  resetRioConfig,
  rioLinkMessage,
  rioUnlinkMessage,
  saveRioSeasonLabel,
  saveRioTiers,
  takeRioCooldown,
  tryBeginRio,
  unlinkRioCharacter,
  type RioGuildLike,
} from '../rio-roles.js';
import type { SlashCommand } from './index.js';

const NO_MENTIONS = { parse: [] as never[] };

async function guard(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.guildId || interaction.guildId !== config.DISCORD_GUILD_ID) {
    await interaction.reply({ content: 'Das geht nur im Magguu-Server.', flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
    return false;
  }
  return true;
}

export const rioLinkCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('rio-link')
    .setDescription('Raider.IO-Charakter verknüpfen und Score-Rolle erhalten (auf Anfrage)')
    .addStringOption((o) => o.setName('charakter').setDescription('Charaktername').setRequired(true).setMinLength(2).setMaxLength(12))
    .addStringOption((o) => o.setName('realm').setDescription('Realm, z. B. Blackrock oder Tarren Mill').setRequired(true).setMinLength(2).setMaxLength(40))
    .addStringOption((o) => {
      o.setName('region').setDescription('Region').setRequired(true);
      for (const r of RIO_REGIONS) o.addChoices({ name: r.toUpperCase(), value: r });
      return o;
    }) as SlashCommandBuilder,
  async execute(interaction) {
    if (!(await guard(interaction))) return;
    const userId = interaction.user.id;
    const tiers = getRioTiers().tiers;
    if (tiers.length === 0) {
      // not set up: a plain hint, no error, nothing logged
      await interaction.reply({ content: RIO_NOT_CONFIGURED_MESSAGE, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
      return;
    }
    const parsed = normaliseRioInput(
      interaction.options.getString('charakter', true),
      interaction.options.getString('realm', true),
      interaction.options.getString('region', true),
    );
    if (!parsed.ok) {
      await interaction.reply({ content: `❌ ${parsed.reason}`, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
      return;
    }
    const wait = takeRioCooldown('link', userId, Date.now());
    if (wait > 0) {
      await interaction.reply({ content: `⏳ Bitte warte noch ${wait} Sekunden, bevor du \`/rio-link\` erneut ausführst.`, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
      return;
    }
    if (!tryBeginRio(userId)) {
      await interaction.reply({ content: '⏳ Deine Anfrage läuft noch.', flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
      return;
    }
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let content: string;
      try {
        const outcome = await linkRioCharacter({
          guild: interaction.guild as unknown as RioGuildLike,
          userId,
          input: parsed.value,
          tiers,
        });
        content = rioLinkMessage(outcome, getRioSeasonLabel());
      } catch (err) {
        logger.warn({ err }, 'rio-link failed');
        content = '⚠️ Das hat nicht geklappt. Versuche es später erneut.';
      }
      await interaction.editReply({ content, allowedMentions: NO_MENTIONS });
    } finally {
      endRio(userId);
    }
  },
};

export const rioUnlinkCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('rio-unlink')
    .setDescription('Raider.IO-Verknüpfung löschen und die Score-Rolle abgeben') as SlashCommandBuilder,
  async execute(interaction) {
    if (!(await guard(interaction))) return;
    const userId = interaction.user.id;
    const wait = takeRioCooldown('unlink', userId, Date.now());
    if (wait > 0) {
      await interaction.reply({ content: `⏳ Bitte warte noch ${wait} Sekunden.`, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
      return;
    }
    if (!tryBeginRio(userId)) {
      await interaction.reply({ content: '⏳ Deine Anfrage läuft noch.', flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
      return;
    }
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let content: string;
      try {
        content = rioUnlinkMessage(await unlinkRioCharacter({ guild: interaction.guild as unknown as RioGuildLike, userId }));
      } catch (err) {
        logger.warn({ err }, 'rio-unlink failed');
        content = '⚠️ Das hat nicht geklappt. Versuche es später erneut.';
      }
      await interaction.editReply({ content, allowedMentions: NO_MENTIONS });
    } finally {
      endRio(userId);
    }
  },
};

function describeTiers(tiers: readonly RioTier[], label: string, problems: readonly string[], source: string): string {
  const lines = tiers.length === 0
    ? ['Keine Schwellen gesetzt (die Funktion ist nicht eingerichtet).']
    : tiers.map((t) => `ab **${t.minScore}** → <@&${t.roleId}>`);
  const head = `**Raider.IO-Rollen** (Quelle: ${source}${label ? `, Season-Label: ${label}` : ''})`;
  const tail = problems.length ? [`⚠️ Probleme: ${problems.join('; ')}`] : [];
  return [head, ...lines, ...tail].join('\n');
}

export const rioConfigCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('rio-config')
    .setDescription('Raider.IO-Score-Schwellen und Rollen festlegen (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('anzeigen').setDescription('Schwellen und Season-Label anzeigen'))
    .addSubcommand((s) => s
      .setName('setzen')
      .setDescription('Schwelle setzen oder ersetzen (Rolle muss existieren)')
      .addNumberOption((o) => o.setName('score').setDescription('Mindest-Score').setRequired(true).setMinValue(0).setMaxValue(10000))
      .addRoleOption((o) => o.setName('rolle').setDescription('Score-Rolle').setRequired(true)))
    .addSubcommand((s) => s
      .setName('entfernen')
      .setDescription('Schwelle entfernen')
      .addNumberOption((o) => o.setName('score').setDescription('Mindest-Score der Schwelle').setRequired(true).setMinValue(0).setMaxValue(10000)))
    .addSubcommand((s) => s
      .setName('season')
      .setDescription('Season-Label setzen (Anzeige, leer = löschen)')
      .addStringOption((o) => o.setName('label').setDescription('z. B. Season 2').setMaxLength(40)))
    .addSubcommand((s) => s.setName('zuruecksetzen').setDescription('Eigene Einstellungen löschen, Werte aus den Umgebungsvariablen nutzen')) as SlashCommandBuilder,
  async execute(interaction) {
    if (!(await guard(interaction))) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: 'Dafür brauchst du „Server verwalten“.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand(true);
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
    const source = (): string => (config.RIO_ROLE_THRESHOLDS ? 'Umgebung oder /rio-config' : '/rio-config');

    if (sub === 'anzeigen') {
      const parsed = getRioTiers();
      await reply(describeTiers(parsed.tiers, getRioSeasonLabel(), parsed.problems, source()));
      return;
    }
    if (sub === 'season') {
      const label = (interaction.options.getString('label') ?? '').trim();
      saveRioSeasonLabel(label);
      await reply(label ? `✅ Season-Label: ${label}` : '✅ Season-Label gelöscht.');
      return;
    }
    if (sub === 'zuruecksetzen') {
      resetRioConfig();
      await reply('✅ Eigene Einstellungen gelöscht, es gelten wieder die Werte aus den Umgebungsvariablen. Bestehende Verknüpfungen bleiben.');
      return;
    }
    const score = interaction.options.getNumber('score', true);
    const tiers = getRioTiers().tiers;
    if (sub === 'entfernen') {
      const next = tiers.filter((t) => t.minScore !== score);
      if (next.length === tiers.length) {
        await reply(`ℹ️ Es gibt keine Schwelle bei ${score}.`);
        return;
      }
      saveRioTiers(next);
      await reply(`✅ Schwelle ${score} entfernt. Rollen, die der Bot schon vergeben hat, bleiben bis zum nächsten /rio-link oder /rio-unlink bestehen.`);
      return;
    }
    // setzen
    const role = interaction.options.getRole('rolle', true);
    // a score role is a display role without rights: @everyone, managed roles and anything with
    // moderation/admin bits are refused (fail closed, also when the permissions cannot be read)
    const verdict = checkScoreRole(role as { id: string; managed?: boolean; permissions?: unknown }, interaction.guildId ?? '');
    if (!verdict.ok) {
      await reply(`❌ Diese Rolle kann nicht als Score-Rolle genutzt werden: ${scoreRoleRefusal(verdict, true)}. Score-Rollen müssen reine Anzeige-Rollen ohne Rechte sein.`);
      return;
    }
    const merged = parseRioThresholds(`${[...tiers.filter((t) => t.minScore !== score), { minScore: score, roleId: role.id }].map((t) => `${t.minScore}=${t.roleId}`).join(',')}`);
    saveRioTiers(merged.tiers);
    const editable = 'editable' in role ? role.editable : null;
    const hint = editable === false ? '\n⚠️ Meine Rolle liegt nicht über dieser Rolle, ich kann sie so nicht vergeben.' : '';
    await reply(`✅ Ab ${score} Punkten gibt es <@&${role.id}>.${hint}\n${describeTiers(merged.tiers, getRioSeasonLabel(), merged.problems, '/rio-config')}`);
  },
};
