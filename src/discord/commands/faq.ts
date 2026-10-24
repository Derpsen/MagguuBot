import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { config } from '../../config.js';
import { Colors, truncate } from '../../embeds/colors.js';
import { CooldownGate, type FaqEntry } from '../../utils/faq-matcher.js';
import { clipChoiceText, faqChoices, neutralizeMentions, searchFaq } from '../../utils/faq-search.js';
import { escapePlexMarkdown } from '../../utils/plex-card.js';
import { recordFaqUse } from '../faq-stats.js';
import { buildFaqAnswerEmbed, getCachedFaqEntries, loadFaqEntries } from '../faq-autoanswer.js';
import type { SlashCommand } from './index.js';

const CONTACT = 'contact@magguu.xyz';
const NO_MENTIONS = { parse: [] as never[] };
const USER_COOLDOWN_MS = 4_000;
const cooldown = new CooldownGate();

/** Network-free: ranks the in-memory website FAQ cache (empty until the first refresh succeeded). */
export function autocompleteFaq(focused: string): { name: string; value: string }[] {
  return faqChoices(focused, getCachedFaqEntries());
}

export async function handleFaqAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await interaction.respond(autocompleteFaq(interaction.options.getFocused()));
}

function infoEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(Colors.info).setTitle('MagguuUI FAQ').setDescription(truncate(description, 4000));
}

function notFoundEmbed(note: string): EmbedBuilder {
  return infoEmbed(
    `${note}\n\nAlle Fragen: ${config.WEBSITE_FAQ_PAGE_URL}\nKontakt: ${CONTACT}`,
  );
}

/** Resolves the option value: an autocomplete id first, otherwise a free-text search. */
export function resolveFaq(
  raw: string,
  entries: readonly FaqEntry[],
): { entry: FaqEntry; others: FaqEntry[] } | { entry: null; others: FaqEntry[]; reason: 'id' | 'text' | 'empty' } {
  const text = raw.trim();
  if (!text) return { entry: null, others: [], reason: 'empty' };
  if (/^\d{1,9}$/.test(text)) {
    const entry = entries.find((e) => e.id === Number(text));
    return entry ? { entry, others: [] } : { entry: null, others: [], reason: 'id' };
  }
  const hits = searchFaq(text, entries, 5).map((h) => h.entry);
  const [entry, ...others] = hits;
  return entry ? { entry, others } : { entry: null, others: [], reason: 'text' };
}

export function buildFaqReply(raw: string, entries: readonly FaqEntry[]): EmbedBuilder {
  if (entries.length === 0) {
    return notFoundEmbed('Das FAQ ist gerade nicht erreichbar. Bitte versuche es später erneut.');
  }
  const res = resolveFaq(raw, entries);
  if (!res.entry) {
    if (res.reason === 'empty') return notFoundEmbed('Bitte gib einen Suchbegriff an.');
    if (res.reason === 'id') return notFoundEmbed('Diesen FAQ-Eintrag gibt es nicht (mehr).');
    const q = escapePlexMarkdown(neutralizeMentions(clipChoiceText(raw, 60)));
    return notFoundEmbed(`Zu „${q}“ habe ich keinen passenden FAQ-Eintrag gefunden.`);
  }
  const embed = buildFaqAnswerEmbed(res.entry, config.WEBSITE_FAQ_PAGE_URL, 'Website-FAQ · /faq suche:');
  if (res.others.length > 0) {
    embed.addFields({
      name: 'Ähnliche Fragen',
      value: truncate(
        res.others.map((e) => `• ${escapePlexMarkdown(neutralizeMentions(clipChoiceText(e.question, 90)))}`).join('\n'),
        1024,
      ),
    });
  }
  return embed;
}

export const faqCommand: SlashCommand = {
  category: 'utility',
  data: new SlashCommandBuilder()
    .setName('faq')
    .setDescription('FAQ durchsuchen (Website-FAQ)')
    .addStringOption((o) =>
      o
        .setName('suche')
        .setDescription('Suchbegriff oder Frage wählen')
        .setRequired(true)
        .setAutocomplete(true)
        .setMaxLength(200),
    )
    .addBooleanOption((o) => o.setName('privat').setDescription('Antwort nur für dich sichtbar')) as SlashCommandBuilder,
  async execute(interaction: ChatInputCommandInteraction) {
    const isPrivate = interaction.options.getBoolean('privat') ?? false;
    if (!cooldown.tryClaim(interaction.user.id, USER_COOLDOWN_MS)) {
      await interaction.reply({
        content: 'Bitte warte einen Moment, bevor du /faq erneut nutzt.',
        flags: MessageFlags.Ephemeral,
        allowedMentions: NO_MENTIONS,
      });
      return;
    }
    await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : undefined);
    let entries: readonly FaqEntry[] = [];
    try {
      entries = await loadFaqEntries();
    } catch {
      entries = [];
    }
    const raw = interaction.options.getString('suche', true);
    await interaction.editReply({ embeds: [buildFaqReply(raw, entries)], allowedMentions: NO_MENTIONS });
    // Anonymous counter after a successful reply: only a resolved entry counts, a picked autocomplete suggestion
    // arrives as its numeric id, free text is a search. No user, channel or text is stored.
    const resolved = entries.length > 0 ? resolveFaq(raw, entries) : null;
    if (resolved?.entry) recordFaqUse(resolved.entry.id, /^\s*\d{1,9}\s*$/.test(raw) ? 'autocomplete' : 'command');
  },
};
