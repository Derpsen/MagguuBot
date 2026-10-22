import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  DiscordAPIError,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type MessageCreateOptions,
  type MessageEditOptions,
  type TextChannel,
} from 'discord.js';
import {
  CARDS,
  RETIRED_CARD_PLAN_NAMES,
  renderCard,
  type RenderedCard,
} from '../../embeds/cards.js';
import { and, eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { db, sqliteHandle } from '../../db/client.js';
import { welcomeMessages } from '../../db/schema.js';
import { cardContextForGuild } from '../card-context.js';
import { ensurePinned } from '../pin.js';
import { logger } from '../../utils/logger.js';
import { isChannelKey, type ChannelKey } from '../channel-store.js';
import { getClient } from '../client.js';
import {
  LAYOUT_CHANNEL_NAMES,
  STRUCTURE,
} from '../server-layout.js';
import { executeActions, type RestLike } from '../../rollout/execute.js';
import {
  describeAction,
  isNewRef,
  planRollout,
  type Action,
  type GuildSnapshot,
  type Ref,
} from '../../rollout/plan.js';
import {
  planWelcomeEmbedSync,
  type SetupWelcomeChannel,
} from '../../utils/setup-plan.js';
import type { SlashCommand } from './index.js';

/**
 * `/setup-server` brings the guild to the lean layout in `server-layout.ts`.
 * It shares the planner with the rollout CLI: renames/reuses via `oldNames`,
 * moves everything else into 🗄️ ARCHIV and NEVER deletes channels or roles.
 * Community, onboarding, welcome screen and role-member migration are only
 * done by `dist/rollout/discord-rollout.js`.
 */

const RETIRED_WELCOME_PLAN_NAMES = RETIRED_CARD_PLAN_NAMES;

/** Actions that belong to the one-shot rollout only. */
const ROLLOUT_ONLY_KINDS: ReadonlySet<Action['kind']> = new Set(['enableCommunity', 'putOnboarding', 'putWelcomeScreen', 'migrateMembers']);

export const WELCOME_POST_PLAN_NAMES: readonly string[] = CARDS.map((p) => p.planName);

/**
 * Mention targets + registered commands at post time. Channels inside
 * 🗄️ ARCHIV or not in the guild never become `<#id>` mentions.
 */
export const setupServerCommand: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription('Kategorien, Kanäle und Rollen anlegen, umbenennen, archivieren (löscht nie)')
    .addBooleanOption((option) => option
      .setName('dry-run')
      .setDescription('Vorschau mit Bestätigungsbutton anzeigen (Standard: ja)'))
    .addBooleanOption((option) => option
      .setName('full')
      .setDescription('Alle angehefteten Panels neu rendern (langsamer)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guild) {
      await interaction.editReply('Dieser Befehl ist nur auf einem Server verfügbar.');
      return;
    }

    const fullSync = interaction.options.getBoolean('full') ?? false;
    if (interaction.options.getBoolean('dry-run') ?? true) {
      await interaction.editReply({
        content: await buildSetupDryRun(interaction.guild, fullSync),
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`setup-server:confirm:${interaction.user.id}:${fullSync ? 'full' : 'fast'}`)
            .setLabel('Änderungen anwenden')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`setup-server:cancel:${interaction.user.id}:${fullSync ? 'full' : 'fast'}`)
            .setLabel('Abbrechen')
            .setStyle(ButtonStyle.Secondary),
        )],
      });
      return;
    }

    await applySetupServer(interaction, fullSync);
  },
};

type SetupInteraction = ChatInputCommandInteraction | ButtonInteraction;

/** Snapshot of the guild from the discord.js cache, in the planner's REST shape. */
export async function snapshotFromGuild(guild: Guild): Promise<GuildSnapshot> {
  await guild.channels.fetch();
  await guild.roles.fetch();
  const me = await guild.members.fetchMe();
  const channels = [...guild.channels.cache.values()]
    .filter((c) => !c.isThread())
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type as number,
      parent_id: c.parentId,
      position: 'rawPosition' in c ? c.rawPosition : 0,
      topic: 'topic' in c ? (c.topic as string | null) : null,
      permission_overwrites: 'permissionOverwrites' in c
        ? [...c.permissionOverwrites.cache.values()].map((o) => ({
          id: o.id,
          type: o.type as 0 | 1,
          allow: o.allow.bitfield.toString(),
          deny: o.deny.bitfield.toString(),
        }))
        : [],
    }));
  const roles = [...guild.roles.cache.values()].map((r) => ({
    id: r.id,
    name: r.name,
    color: r.colors.primaryColor,
    position: r.rawPosition,
    permissions: r.permissions.bitfield.toString(),
    managed: r.managed,
    hoist: r.hoist,
    mentionable: r.mentionable,
  }));
  const channelConfig: Partial<Record<ChannelKey, string>> = {};
  for (const row of sqliteHandle.prepare('SELECT key, channel_id FROM channel_config WHERE guild_id = ?').all(guild.id) as Array<{ key: string; channel_id: string }>) {
    if (isChannelKey(row.key)) channelConfig[row.key] = row.channel_id;
  }
  const autoRow = sqliteHandle.prepare("SELECT value FROM bot_settings WHERE guild_id = ? AND key = 'autoRoleId'").get(guild.id) as { value: string } | undefined;
  return {
    guildId: guild.id,
    botUserId: me.id,
    botHighestRolePosition: me.roles.highest.rawPosition,
    features: [...guild.features],
    rulesChannelId: guild.rulesChannelId,
    publicUpdatesChannelId: guild.publicUpdatesChannelId,
    verificationLevel: guild.verificationLevel,
    explicitContentFilter: guild.explicitContentFilter,
    channels,
    roles,
    members: null,
    channelConfig,
    autoRoleSetting: autoRow?.value ?? null,
    onboarding: null,
    welcomeScreen: null,
  };
}

function setupPlan(snap: GuildSnapshot): { actions: Action[]; manual: string[]; channelRefs: Record<string, Ref> } {
  const plan = planRollout(snap);
  return {
    actions: plan.actions.filter((a) => !ROLLOUT_ONLY_KINDS.has(a.kind)),
    manual: plan.manual.filter((m) => !m.startsWith('Mitgliederliste')),
    channelRefs: plan.channelRefs,
  };
}

/** discord.js REST (shared rate limiter with the running bot) behind the executor interface. */
export function clientRestFor(guild: Guild): RestLike {
  return {
    async request<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T | null> {
      try {
        const result = await guild.client.rest.request({
          method: method as never,
          fullRoute: path as `/${string}`,
          body,
          reason: 'MagguuBot /setup-server',
        });
        return (result ?? null) as T | null;
      } catch (err) {
        if (err instanceof DiscordAPIError && okStatuses.includes(err.status)) return null;
        throw err;
      }
    },
  };
}

function welcomeStatuses(actions: Action[], channelRefs: Record<string, Ref>): SetupWelcomeChannel[] {
  return CARDS.map((post) => {
    const ref = channelRefs[post.channel];
    if (!ref || isNewRef(ref)) return { planName: post.planName, status: 'create' as const };
    const renamed = actions.some((a) => a.kind === 'updateChannel' && a.id === ref && a.changes.name);
    return { planName: post.planName, status: renamed ? 'rename' as const : 'exists' as const };
  });
}

function trackedPlanNames(): Set<string> {
  return new Set(db
    .select({ planName: welcomeMessages.planName })
    .from(welcomeMessages)
    .where(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID))
    .all()
    .map((row) => row.planName));
}

const rolesChangedBy = (actions: Action[]): boolean =>
  actions.some((a) => a.kind === 'createRole' || (a.kind === 'updateRole' && Boolean(a.changes.name) && !a.blocked));
const refsChangedBy = (actions: Action[]): boolean => actions.some((a) => a.kind === 'setChannelKey');

async function applySetupServer(interaction: SetupInteraction, fullSync = false): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('Dieser Befehl ist nur auf einem Server verfügbar.');
    return;
  }
  const permCheck = await assertBotPermissions(guild);
  if (!permCheck.ok) {
    await interaction.editReply(
      [
        '⚠️ **Dem Bot fehlen Berechtigungen** — `/setup-server` würde teilweise stillschweigend scheitern.',
        '',
        `Fehlend: \`${permCheck.missing.join('`, `')}\``,
        '',
        '**Lösung:** Servereinstellungen → Rollen → **MagguuBot** → **Administrator** aktivieren (einfachste Lösung), oder die fehlenden Berechtigungen einzeln setzen. Danach `/setup-server` erneut ausführen.',
      ].join('\n'),
    );
    return;
  }

  const snap = await snapshotFromGuild(guild);
  const plan = setupPlan(snap);
  const { results, ids } = await executeActions(clientRestFor(guild), snap, plan.actions, plan.manual);
  const resolve = (ref: Ref | undefined): string | undefined => (ref ? (isNewRef(ref) ? ids.get(ref) : ref) : undefined);

  // Tracked panels follow their channel when it is renamed (e.g. ❓・faq → ❓・hilfe).
  for (const a of plan.actions) {
    if (a.kind !== 'updateChannel' || !a.changes.name) continue;
    migrateWelcomePlanName(a.current, a.changes.name, a.id);
  }

  const removed: string[] = [];
  for (const planName of RETIRED_WELCOME_PLAN_NAMES) {
    const row = db
      .select()
      .from(welcomeMessages)
      .where(and(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID), eq(welcomeMessages.planName, planName)))
      .get();
    if (!row) continue;
    try {
      const channel = await guild.channels.fetch(row.channelId).catch(() => null);
      if (channel && 'messages' in channel) {
        const msg = await channel.messages.fetch(row.messageId).catch(() => null);
        await msg?.delete().catch(() => {});
      }
    } catch (err) {
      logger.debug({ err, planName }, 'retired welcome embed delete failed');
    }
    db.delete(welcomeMessages)
      .where(and(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID), eq(welcomeMessages.planName, planName)))
      .run();
    removed.push(`welcome embed: ${planName}`);
  }

  await guild.channels.fetch();
  const layoutIds: Record<string, string | undefined> = {};
  for (const [name, ref] of Object.entries(plan.channelRefs)) layoutIds[name] = resolve(ref);
  const ctx = await cardContextForGuild(guild, layoutIds);

  const planned = planWelcomeEmbedSync({
    fullSync,
    rolesChanged: rolesChangedBy(plan.actions),
    refsChanged: refsChangedBy(plan.actions),
    welcomePlanNames: new Set(WELCOME_POST_PLAN_NAMES),
    channels: welcomeStatuses(plan.actions, plan.channelRefs),
    trackedPlanNames: trackedPlanNames(),
  });
  const toSync = new Set([...planned.post, ...planned.edit]);
  let embedsPosted = 0;
  let embedsUpdated = 0;
  let pinsOk = 0;
  let pinsFailed = 0;
  for (const spec of CARDS) {
    if (!toSync.has(spec.planName)) continue;
    const channelId = layoutIds[spec.channel];
    if (!channelId) continue;
    try {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased() || channel.isThread()) continue;
      const result = await upsertWelcomeEmbed(channel as TextChannel, renderCard(spec, ctx), spec.pin);
      if (result.status === 'created') embedsPosted++;
      else if (result.status === 'updated') embedsUpdated++;
      if (result.pinned) pinsOk++;
      else pinsFailed++;
    } catch (err) {
      logger.warn({ err, channel: spec.planName }, 'welcome embed upsert failed');
    }
  }

  const ok = results.filter((r) => r.status === 'ok');
  const errors = results.filter((r) => r.status === 'error');
  const manual = [...plan.manual];
  logger.info({ actions: plan.actions.length, ok: ok.length, errors: errors.length, mode: fullSync ? 'full' : 'fast' }, 'server setup completed');

  const lines: string[] = [];
  if (ok.length) lines.push(`**✅ Angewendet (${ok.length})**\n${ok.slice(0, 18).map((r) => `• ${r.action}`).join('\n')}${ok.length > 18 ? `\n… und ${ok.length - 18} weitere` : ''}`);
  if (errors.length) lines.push(`**⚠️ Fehler (${errors.length})**\n${errors.slice(0, 6).map((r) => `• ${r.action}: ${r.detail ?? ''}`.slice(0, 180)).join('\n')}`);
  if (removed.length) lines.push(`**🗑 Alte Welcome-Embeds entfernt (${removed.length})**\n${removed.join('\n')}`);
  if (embedsPosted) lines.push(`**💬 Panels gepostet:** ${embedsPosted}`);
  if (embedsUpdated) lines.push(`**✏️ Panels editiert:** ${embedsUpdated}`);
  if (pinsOk || pinsFailed) {
    lines.push(`**📌 Anheften:** ${pinsOk} ok${pinsFailed ? ` · ⚠️ ${pinsFailed} fehlgeschlagen → Die MagguuBot-Rolle braucht **Administrator** (oder mindestens Nachrichten, Kanäle und Rollen verwalten)` : ''}`);
  }
  if (manual.length) lines.push(`**✋ Manuell (${manual.length})**\n${manual.slice(0, 4).map((m) => `• ${m}`.slice(0, 300)).join('\n')}`);
  lines.push('_Gelöscht wird hier nie. Alte Kanäle liegen in 🗄️ ARCHIV. Community/Onboarding: Rollout-Skript._');

  await interaction.editReply({
    content: lines.join('\n\n').slice(0, 1900) || 'Alles bereits aktuell.',
    components: [],
  });
}

function migrateWelcomePlanName(from: string, to: string, channelId: string): void {
  const target = db.select().from(welcomeMessages)
    .where(and(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID), eq(welcomeMessages.planName, to)))
    .get();
  if (target) return;
  db.update(welcomeMessages)
    .set({ planName: to, updatedAt: new Date() })
    .where(and(
      eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID),
      eq(welcomeMessages.planName, from),
      eq(welcomeMessages.channelId, channelId),
    ))
    .run();
}

export async function handleSetupServerButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, ownerId, mode] = interaction.customId.split(':');
  if (!interaction.guild || !ownerId || interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Nur die Person, die die Vorschau gestartet hat, kann sie bestätigen.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Dafür sind Administratorrechte erforderlich.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === 'cancel') {
    await interaction.update({ content: 'Setup abgebrochen – es wurden keine Änderungen vorgenommen.', components: [] });
    return;
  }
  if (action !== 'confirm') {
    await interaction.reply({ content: 'Diese Setup-Aktion ist ungültig.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update({ content: '⏳ Setup wird angewendet …', components: [] });
  await applySetupServer(interaction, mode === 'full');
}

async function buildSetupDryRun(guild: Guild, fullSync: boolean): Promise<string> {
  const snap = await snapshotFromGuild(guild);
  const plan = setupPlan(snap);
  const planned = planWelcomeEmbedSync({
    fullSync,
    rolesChanged: rolesChangedBy(plan.actions),
    refsChanged: refsChangedBy(plan.actions),
    welcomePlanNames: new Set(WELCOME_POST_PLAN_NAMES),
    channels: welcomeStatuses(plan.actions, plan.channelRefs),
    trackedPlanNames: trackedPlanNames(),
  });
  const group = (kinds: Action['kind'][]): string[] => plan.actions.filter((a) => kinds.includes(a.kind)).map(describeAction);
  const section = (label: string, items: string[]): string =>
    `**${label} (${items.length})**\n${items.length ? items.slice(0, 10).map((item) => `• ${item}`).join('\n') : 'Nichts'}${items.length > 10 ? `\n… und ${items.length - 10} weitere` : ''}`;
  const lines = [
    '🧪 **Setup Dry-Run – noch nichts angewendet**',
    section('Anlegen', group(['createCategory', 'createChannel', 'createRole'])),
    section('Umbenennen/Verschieben/Rechte', group(['updateChannel', 'updateRole', 'reorder'])),
    section('Archivieren (nicht löschen)', group(['archiveChannel', 'hideCategory'])),
    section('Bot-Keys', group(['setChannelKey', 'setAutoRole'])),
    `**Panels neu posten (${planned.post.length}) · editieren (${planned.edit.length})**`,
  ];
  if (plan.manual.length) lines.push(section('Manuell', plan.manual.map((m) => m.slice(0, 200))));
  lines.push(`_Layout: ${STRUCTURE.length} Kategorien, ${LAYOUT_CHANNEL_NAMES.size} Kanäle. Gelöscht wird nichts._`);
  return lines.join('\n\n').slice(0, 1_950);
}

interface UpsertResult {
  status: 'created' | 'updated' | 'noop';
  pinned: boolean;
}

async function upsertWelcomeEmbed(channel: TextChannel, card: RenderedCard, pin: boolean): Promise<UpsertResult> {
  const planName = card.spec.planName;
  const body = { ...card.body, allowedMentions: { parse: [] } } as unknown as MessageCreateOptions & MessageEditOptions;
  const existing = db
    .select()
    .from(welcomeMessages)
    .where(and(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID), eq(welcomeMessages.planName, planName)))
    .get();

  if (existing && existing.channelId === channel.id) {
    try {
      const message = await channel.messages.fetch(existing.messageId);
      if (message.author.id !== channel.client.user.id) throw new Error('not a bot message');
      if (existing.contentHash !== card.hash) await message.edit(body);
      const pinned = pin ? await ensurePinned(message) : true;
      db.update(welcomeMessages)
        .set({ channelId: channel.id, contentHash: card.hash, updatedAt: new Date() })
        .where(and(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID), eq(welcomeMessages.planName, planName)))
        .run();
      return { status: existing.contentHash === card.hash ? 'noop' : 'updated', pinned };
    } catch {
      logger.debug({ planName, messageId: existing.messageId }, 'stored welcome message gone, re-posting');
    }
  }

  const message = await channel.send(body);
  const pinned = pin ? await ensurePinned(message) : true;
  db.insert(welcomeMessages)
    .values({ guildId: config.DISCORD_GUILD_ID, planName, channelId: channel.id, messageId: message.id, contentHash: card.hash })
    .onConflictDoUpdate({
      target: [welcomeMessages.guildId, welcomeMessages.planName],
      set: { channelId: channel.id, messageId: message.id, contentHash: card.hash, updatedAt: new Date() },
    })
    .run();
  return { status: 'created', pinned };
}

export interface BotPermCheckResult {
  ok: boolean;
  missing: string[];
  hasAdmin: boolean;
}

export async function assertBotPermissions(guild: import('discord.js').Guild): Promise<BotPermCheckResult> {
  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) return { ok: false, missing: ['(bot member not fetchable)'], hasAdmin: false };
  const perms = me.permissions;
  const Flags = (await import('discord.js')).PermissionFlagsBits;

  if (perms.has(Flags.Administrator)) return { ok: true, missing: [], hasAdmin: true };

  const required = [
    { flag: Flags.ManageRoles, name: 'ManageRoles' },
    { flag: Flags.ManageChannels, name: 'ManageChannels' },
    { flag: Flags.ManageMessages, name: 'ManageMessages' },
    { flag: Flags.ManageGuild, name: 'ManageGuild' },
    { flag: Flags.SendMessages, name: 'SendMessages' },
    { flag: Flags.EmbedLinks, name: 'EmbedLinks' },
  ];
  const missing = required.filter((r) => !perms.has(r.flag)).map((r) => r.name);
  return { ok: missing.length === 0, missing, hasAdmin: false };
}

export async function backfillWelcomePins(): Promise<{
  checked: number;
  pinned: number;
  failed: number;
  abortedReason?: string;
}> {
  const rows = db
    .select()
    .from(welcomeMessages)
    .where(eq(welcomeMessages.guildId, config.DISCORD_GUILD_ID))
    .all();

  let pinned = 0;
  let failed = 0;
  let abortedReason: string | undefined;
  for (const row of rows) {
    try {
      const channel = (await getClient().channels.fetch(row.channelId).catch(() => null)) as TextChannel | null;
      if (!channel?.isTextBased()) continue;
      const message = await channel.messages.fetch(row.messageId).catch(() => null);
      if (!message) continue;
      if (message.pinned) continue;
      const ok = await ensurePinned(message);
      if (ok) {
        pinned++;
      } else {
        failed++;
        // Quick-abort: if first failure is 50013 (Missing Permissions), don't spam — bot lacks global ManageMessages
        if (failed === 1 && pinned === 0) {
          abortedReason =
            'first pin attempt got Missing Permissions (50013) — bot role lacks ManageMessages globally; aborting backfill to avoid log spam';
          logger.warn({ checked: pinned + failed, total: rows.length, hint: 'add Administrator (or ManageMessages + ManageChannels + ManageRoles) to the MagguuBot role in Server Settings -> Roles' }, abortedReason);
          break;
        }
      }
    } catch (err) {
      logger.debug({ err, planName: row.planName }, 'backfill pin attempt errored');
      failed++;
    }
  }

  if (pinned > 0 || failed > 0) {
    logger.info({ checked: rows.length, pinned, failed, abortedReason }, 'welcome-pin backfill complete');
  }
  return { checked: rows.length, pinned, failed, abortedReason };
}


