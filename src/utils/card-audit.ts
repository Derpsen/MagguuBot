/**
 * Pure checks over bot-authored messages (pins and tracked cards):
 * - `<#id>` mentions of channels that no longer exist ("#unbekannt")
 * - slash commands (`` `/name` `` or `</name:id>`) that are not registered
 *
 * Shared by `/doctor` and `dist/rollout/discord-cards.js --check`.
 */
import type { CommandInfo } from '../embeds/cards.js';

export interface AuditEmbed {
  title?: string | null;
  description?: string | null;
  fields?: Array<{ name?: string; value?: string }> | null;
  footer?: { text?: string } | null;
  author?: { name?: string } | null;
}

export interface AuditMessage {
  channelId: string;
  channelName?: string;
  messageId: string;
  pinned?: boolean;
  content?: string | null;
  embeds?: AuditEmbed[] | null;
}

export interface AuditFinding {
  kind: 'deadChannel' | 'unknownCommand';
  channelId: string;
  channelName?: string;
  messageId: string;
  /** Offending token, e.g. `<#123>` or `/foo bar`. */
  token: string;
}

export function messageText(msg: Pick<AuditMessage, 'content' | 'embeds'>): string {
  const parts: string[] = [];
  if (msg.content) parts.push(msg.content);
  for (const e of msg.embeds ?? []) {
    if (e.title) parts.push(e.title);
    if (e.description) parts.push(e.description);
    if (e.author?.name) parts.push(e.author.name);
    for (const f of e.fields ?? []) parts.push(f.name ?? '', f.value ?? '');
    if (e.footer?.text) parts.push(e.footer.text);
  }
  return parts.join('\n');
}

const CHANNEL_MENTION = /<#(\d{17,20})>/g;
const SLASH_MENTION = /<\/([\w-]{1,32})((?: [\w-]{1,32}){0,2}):\d{17,20}>/g;
const BACKTICK_COMMAND = /`\/([a-z0-9][\w-]{0,31})(?: ([a-z][\w-]{0,31}))?/g;

export function findDeadChannelMentions(text: string, existing: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CHANNEL_MENTION)) if (!existing.has(m[1] as string)) out.add(m[0]);
  return [...out];
}

/** In-game WoW chat commands that appear in MagguuUI help; not Discord commands. */
export const IN_GAME_COMMANDS: ReadonlySet<string> = new Set(['mui', 'reload', 'rl', 'eui', 'console', 'fstack', 'dump', 'bw', 'mdt']);

export function findUnknownCommands(
  text: string,
  commands: ReadonlyMap<string, CommandInfo>,
  ignore: ReadonlySet<string> = IN_GAME_COMMANDS,
): string[] {
  const out = new Set<string>();
  const check = (name: string, sub: string | undefined): void => {
    if (ignore.has(name) && !commands.has(name)) return;
    const info = commands.get(name);
    if (!info) {
      out.add(`/${name}`);
      return;
    }
    // Only judge the second word when the command really has subcommands.
    if (sub && info.subcommands.size > 0 && !info.subcommands.has(sub)) {
      const group = [...info.subcommands].some((s) => s.startsWith(`${sub} `));
      if (!group) out.add(`/${name} ${sub}`);
    }
  };
  for (const m of text.matchAll(SLASH_MENTION)) check(m[1] as string, (m[2] ?? '').trim() || undefined);
  for (const m of text.matchAll(BACKTICK_COMMAND)) check(m[1] as string, m[2]);
  return [...out];
}

export function auditMessages(
  messages: Iterable<AuditMessage>,
  existingChannelIds: ReadonlySet<string>,
  commands: ReadonlyMap<string, CommandInfo>,
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const seen = new Set<string>();
  for (const msg of messages) {
    if (seen.has(msg.messageId)) continue;
    seen.add(msg.messageId);
    const text = messageText(msg);
    const base = { channelId: msg.channelId, channelName: msg.channelName, messageId: msg.messageId };
    for (const token of findDeadChannelMentions(text, existingChannelIds)) findings.push({ kind: 'deadChannel', token, ...base });
    for (const token of findUnknownCommands(text, commands)) findings.push({ kind: 'unknownCommand', token, ...base });
  }
  return findings;
}

/** One line per finding, German, for /doctor and the CLI. */
export function describeFinding(f: AuditFinding): string {
  const where = f.channelName ? `#${f.channelName}` : f.channelId;
  return f.kind === 'deadChannel'
    ? `${where} · Nachricht ${f.messageId}: Kanal ${f.token} existiert nicht mehr`
    : `${where} · Nachricht ${f.messageId}: Befehl ${f.token} ist nicht registriert`;
}

// ─── Export masking ──────────────────────────────────────────────────────

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Discord bot tokens (three base64url segments)
  [/\b[MNO][\w-]{23,27}\.[\w-]{6}\.[\w-]{27,40}\b/g, '[token]'],
  // Discord / generic webhook URLs
  [/https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/g, 'https://discord.com/api/webhooks/[masked]'],
  // Bearer and query/header style secrets
  [/\b(Bearer|Bot)\s+[\w.~+/-]{16,}=*/g, '$1 [masked]'],
  [/([?&](?:token|apikey|api_key|key|secret|password|access_token)=)[^&\s)"']+/gi, '$1[masked]'],
  [/\b((?:api[_-]?key|token|secret|password)\s*[:=]\s*)["']?[^\s"',]{6,}/gi, '$1[masked]'],
  // Long hex / base64-ish blobs (API keys)
  [/\b[a-f0-9]{32,}\b/gi, '[masked]'],
];

export function maskSecrets(text: string): string {
  let out = text;
  for (const [re, repl] of SECRET_PATTERNS) out = out.replace(re, repl);
  return out;
}

/** Deep-mask every string in a JSON-able value. */
export function maskDeep<T>(value: T): T {
  if (typeof value === 'string') return maskSecrets(value) as T;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskDeep(v);
    return out as T;
  }
  return value;
}
