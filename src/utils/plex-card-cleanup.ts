/**
 * Pure classification for the one-time removal of the OLD Plex activity cards.
 *
 * A message is a removal candidate only when ALL hold: the bot wrote it, it is not pinned and not
 * tracked in SQLite as a live message (per-user cards, weekly card, digest, panels, ...), it has no
 * text content and exactly one embed, and that embed carries the footer of a former Plex activity
 * card. Everything else - including anything in doubt - stays.
 */

export interface CleanupEmbedView {
  title?: string | null;
  author?: string | null;
  footer?: string | null;
}

export interface CleanupMessageView {
  id: string;
  authorId: string;
  pinned: boolean;
  content: string;
  embeds: CleanupEmbedView[];
}

export type CleanupVerdict =
  | 'candidate'
  | 'foreign-author'
  | 'pinned'
  | 'protected'
  | 'not-a-card'
  | 'not-plex-activity';

const LEGACY_KIND_FOOTER = /^MagguuBot · (play|pause|resume|stop|watched|buffer|error)$/;

/** Footer text with the spacing variants Discord/clients may show normalized. */
function normFooter(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+·\s+/g, ' · ').trim();
}

/**
 * Footers of every former Plex activity card in the Plex channel:
 * - the single card (`MagguuBot · Plex-Aktivität (eine Karte, wird aktualisiert)`) and the per-session
 *   lifecycle cards (`MagguuBot · Plex-Aktivität`, also after a stop/pause edit),
 * - the first Plex activity feed (`MagguuBot · Plex activity`, author `Plex Activity · …`),
 * - the plain event feed (`MagguuBot · play|pause|…`, author `Plex · …`).
 * The new per-user cards (`MagguuBot · Plex-Nutzerkarte …`), the weekly card, the digest and /neu never match.
 */
export function isFormerPlexActivityEmbed(embed: CleanupEmbedView): boolean {
  const footer = normFooter(embed.footer);
  const author = (embed.author ?? '').trim();
  if (footer === 'MagguuBot · Plex-Aktivität') return true;
  if (footer === 'MagguuBot · Plex-Aktivität (eine Karte, wird aktualisiert)') return true;
  if (footer === 'MagguuBot · Plex activity') return author.startsWith('Plex Activity');
  if (LEGACY_KIND_FOOTER.test(footer)) return author.startsWith('Plex · ');
  return false;
}

export function classifyCleanupMessage(
  message: CleanupMessageView,
  options: { botId: string; protectedIds: ReadonlySet<string> },
): CleanupVerdict {
  if (message.authorId !== options.botId) return 'foreign-author';
  if (options.protectedIds.has(message.id)) return 'protected';
  if (message.pinned) return 'pinned';
  if (message.content.trim() !== '' || message.embeds.length !== 1) return 'not-a-card';
  const [embed] = message.embeds;
  return embed && isFormerPlexActivityEmbed(embed) ? 'candidate' : 'not-plex-activity';
}
