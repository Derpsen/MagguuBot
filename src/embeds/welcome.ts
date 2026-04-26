import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIMessageComponentEmoji,
} from 'discord.js';
import { Colors } from './colors.js';

export interface ColorRoleDef {
  name: string;
  color: number;
  emoji: string;
  label: string;
}

export interface ChannelRefs {
  welcome?: string;
  rules?: string;
  roles?: string;
  botHelp?: string;
  announcements?: string;
  requests?: string;
  approvals?: string;
  newOnPlex?: string;
  grabs?: string;
  imports?: string;
  failures?: string;
  health?: string;
  general?: string;
  botCommands?: string;
  modLog?: string;
  auditLog?: string;
  github?: string;
  starboard?: string;
  plexActivity?: string;
  maintainerr?: string;
  blueTracker?: string;
  addonUpdates?: string;
  faq?: string;
  suggestions?: string;
}

function m(id: string | undefined, fallback: string): string {
  return id ? `<#${id}>` : `**#${fallback}**`;
}

export function buildWelcomeHeroEmbed(r: ChannelRefs): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle('👋 Willkommen im Magguu Homelab')
    .setDescription(
      [
        '**Dein privater Downloads + Plex-Hub** — self-hosted, ad-frei, immer an.',
        '',
        'Hier landet alles, was in meinem Stack passiert: neue Requests, Grabs von Sonarr/Radarr, fertige Downloads aus SABnzbd, Plex-Arrivals und GitHub-Pushes.',
      ].join('\n'),
    )
    .addFields(
      {
        name: '🚀 Quick-Start',
        value: [
          `**1.** Regeln lesen → ${m(r.rules, 'regeln')}`,
          `**2.** Rollen holen → ${m(r.roles, 'rollen')}`,
          `**3.** Erste Anfrage → ${m(r.requests, 'requests')}`,
          `**4.** Commands entdecken → ${m(r.botHelp, 'bot-hilfe')}`,
        ].join('\n'),
      },
      {
        name: '🔗 Nützliche Links',
        value: [
          '• [Plex-Web öffnen](https://app.plex.tv)',
          '• `/queue` — Download-Queue im Chat',
          '• `/search` — Medien requesten',
        ].join('\n'),
        inline: true,
      },
      {
        name: '💡 Pro-Tipps',
        value: [
          '• `/queue` — live Download-Stand',
          '• `/rank` — dein Server-Level',
          '• `/remindme 2h Film` — DM-Reminder',
        ].join('\n'),
        inline: true,
      },
    )
    .setFooter({ text: 'MagguuBot  ·  Sonarr / Radarr / Seerr / SABnzbd / Tautulli' })
    .setTimestamp(new Date());
}

export function buildRulesEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.warn)
    .setTitle('📜 Server-Regeln')
    .setDescription(
      '**Kurze Liste, freundlicher Server.** Alle hier sind freiwillig Gäste — respektiert euch gegenseitig.',
    )
    .addFields(
      {
        name: '1️⃣ Respekt',
        value: 'Kein Rassismus, keine Beleidigungen, kein Drama. Uneinigkeit → DM, nicht Channel.',
      },
      {
        name: '2️⃣ Spoiler sind Spoiler',
        value: 'Packt sie in `||Spoiler-Tags||` oder geht in `#🔇・spoiler-zone`. Ein Staffel-Finale ruiniert Freundschaften.',
      },
      {
        name: '3️⃣ Keine Piraterie',
        value: 'Keine Download-Links, keine Torrents, keine NZBs. Requests laufen ausschließlich über Seerr.',
      },
      {
        name: '4️⃣ Ein Thema → Ein Channel',
        value: 'Downloads-Fragen ins Downloads-Channel, Smalltalk in den Chat. Admins verschieben sonst.',
      },
      {
        name: '5️⃣ Admin hat das letzte Wort',
        value: 'Requests können abgelehnt werden. Widerspruch per DM, nicht im Channel. Kein Nachkarten.',
      },
      {
        name: '⚠️ Verstöße',
        value: '`Warnung` → `Timeout` → `Kick` → `Ban`. Sichtbar im Mod-Log für Transparenz.',
      },
    )
    .setFooter({ text: 'MagguuBot  ·  Regeln v1' })
    .setTimestamp(new Date());
}

export function buildBotHelpEmbed(r: ChannelRefs): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle('🤖 Bot-Befehle — Quick Reference')
    .setDescription('Tipp `/` in irgendeinen Channel für Autocomplete. `/help` zeigt die volle Liste mit Kategorien.')
    .addFields(
      {
        name: '📥 Downloads',
        value: [
          '`/queue` — Sonarr+Radarr+SAB live queue',
          '`/arr-status` — Service-Health + Disk-Space + Versionen',
          '`/search movie <query>` — Radarr-Lookup',
          '`/search show <query>` — Sonarr-Lookup',
          '`/calendar` — kommende Releases',
          '`/plex-top` — Top Filme/Serien/User aus Tautulli',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🎮 Utility',
        value: [
          '`/help` — alle Commands nach Kategorie',
          '`/rank` [user] — Level + XP-Bar als Karte',
          '`/leaderboard` — Top 10',
          '`/rep give|show|leaderboard` — Reputation',
          '`/remindme <zeit> <text>` — DM-Reminder',
          '`/poll <frage> <optionen>` — Reaction-Poll',
          '`/countdown create|list|remove` — Countdown-Embeds',
          '`/userinfo` `/serverinfo` `/avatar` `/botinfo`',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🛡️ Moderation (gated)',
        value: [
          '`/warn` `/timeout` `/kick` `/ban` `/unban`',
          '`/purge` `/purge-user`',
          '`/slowmode <seconds>` — Discord-native Channel-Slowmode',
          '_Alles automatisch im Mod-Log dokumentiert._',
        ].join('\n'),
        inline: false,
      },
      {
        name: '⚙️ Admin',
        value: [
          '`/announce` — styled Embed in einen Channel',
          '`/setup-server` — Struktur neu aufbauen/sortieren (idempotent)',
          '`/cleanup-server` — Orphan-Channels löschen (mit Confirm)',
          '`/tag add|edit|delete` — Custom-Text-Antworten',
          '`/autoresponder` — Pattern-Trigger-Autoreplies',
          '`/schedule-announce` — geplante Posts (mit Wiederholung)',
          '`/sticky set|remove` — Sticky-Messages pro Channel',
          '`/ticket-panel` — Support-Tickets via Button',
          '`/db-backup` — SQLite-Snapshot',
          '`/roles-panel create|add|remove` — Self-Service Rollen-Buttons',
        ].join('\n'),
        inline: false,
      },
      {
        name: '📨 Automatische Posts',
        value: [
          `• Grabs → ${m(r.grabs, 'grabs')}`,
          `• Imports → ${m(r.imports, 'imports')}`,
          `• Fehler → ${m(r.failures, 'failures')}`,
          `• Requests-Approvals → ${m(r.approvals, 'approvals')}`,
          `• Neu auf Plex → ${m(r.newOnPlex, 'new-on-plex')}`,
          `• Health → ${m(r.health, 'health')}`,
          `• GitHub → ${m(r.github, 'github')}`,
          `• Welcome-Card → ${m(r.welcome, 'welcomen')} (gerendertes PNG bei Join)`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'MagguuBot  ·  /help für die volle Liste mit Kategorien' })
    .setTimestamp(new Date());
}

export function buildRolePickerEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.seerr)
    .setTitle('🎭 Deine Rollen')
    .setDescription(
      [
        'Klick auf einen Button — toggelt die Rolle an/aus.',
        '',
        '**🔓 Interessen** (obere Reihe) — schalten Channels frei. Ohne diese siehst du als Newcomer nur das Nötigste.',
        '',
        '**🔔 Pings** (untere Reihen) — du wirst benachrichtigt wenn was Relevantes passiert.',
        '',
        '_Rang-Rollen (Regular/VIP) vergibt der Bot automatisch nach Aktivität. Plex-User-Rolle vergibt ein Admin manuell für Request-Zugriff._',
      ].join('\n'),
    )
    .addFields(
      {
        name: '🔓 Interessen — Channels freischalten',
        value: [
          '🎬 **Plex-Interesse** — schaltet MEDIA + DOWNLOADS frei',
          '🎮 **WoW-Interesse** — schaltet blue-tracker frei',
          '🎨 **Addon-Interesse** — schaltet addon-updates frei',
        ].join('\n'),
        inline: false,
      },
      {
        name: '📺 Media-Pings',
        value: [
          '🎬 **Film-Alerts** — Radarr Grabs',
          '📺 **Serien-Alerts** — Sonarr Grabs',
          '🔊 **4K-Alerts** — nur bei 2160p-Releases (zusätzlich)',
          '🌸 **Anime-Alerts** — manuelles Ping',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🎮 WoW + Meta-Pings',
        value: [
          '⚔️ **Class Tuning** — Balance/Hotfix Blue-Posts',
          '🧪 **PTR-Alerts** — Public Test Realm Patchnotes',
          '📢 **Announcements** — Server-Broadcasts',
          '🔨 **GitHub Releases** — neue Bot/Stack-Versionen',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🎨 Nickname-Farbe',
        value: 'Im selben Channel — separate Message mit Color-Buttons direkt unter diesem Embed.',
        inline: false,
      },
    )
    .setFooter({ text: 'MagguuBot  ·  opt-in, opt-out, alles chill' });
}

interface ButtonDef {
  role: string;
  label: string;
  emoji: string;
  style?: ButtonStyle;
}

const INTEREST_BUTTONS: ButtonDef[] = [
  { role: 'Plex-Fan', label: 'Plex', emoji: '🎬', style: ButtonStyle.Primary },
  { role: 'WoW-Fan', label: 'WoW', emoji: '🎮', style: ButtonStyle.Primary },
  { role: 'MagguuUI', label: 'MagguuUI', emoji: '🎨', style: ButtonStyle.Primary },
];

const PING_BUTTONS: ButtonDef[] = [
  { role: 'ping-movies', label: 'Film', emoji: '🎬' },
  { role: 'ping-series', label: 'Serien', emoji: '📺' },
  { role: 'ping-4k', label: '4K', emoji: '🔊' },
  { role: 'ping-anime', label: 'Anime', emoji: '🌸' },
  { role: 'ping-wow-tuning', label: 'WoW Tuning', emoji: '⚔️' },
  { role: 'ping-wow-ptr', label: 'WoW PTR', emoji: '🧪' },
  { role: 'ping-announcements', label: 'Announcements', emoji: '📢' },
  { role: 'ping-github', label: 'GitHub', emoji: '🔨' },
];

export function buildColorRoleButtons(colorRoles: ColorRoleDef[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < colorRoles.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const c of colorRoles.slice(i, i + 5)) {
      const emoji: APIMessageComponentEmoji = { name: c.emoji };
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`color:toggle:${c.name}`)
          .setLabel(c.label)
          .setEmoji(emoji)
          .setStyle(ButtonStyle.Secondary),
      );
    }
    rows.push(row);
  }
  return rows;
}

export function buildColorRolePickerEmbed(colorRoles: ColorRoleDef[]): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle('🎨 Nickname-Farbe wählen')
    .setDescription(
      [
        'Klick eine Farbe → wird als Nickname-Farbe gesetzt. Nochmal klicken → wieder default.',
        '_Nur eine Farbe gleichzeitig — andere werden automatisch entfernt._',
        '',
        colorRoles.map((c) => `${c.emoji} **${c.label}**`).join('   '),
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  cosmetic only' });
}

export function buildRolePickerButtons(): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  const interestRow = new ActionRowBuilder<ButtonBuilder>();
  for (const def of INTEREST_BUTTONS) {
    interestRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`role:toggle:${def.role}`)
        .setLabel(def.label)
        .setEmoji(def.emoji)
        .setStyle(def.style ?? ButtonStyle.Primary),
    );
  }
  rows.push(interestRow);

  for (let i = 0; i < PING_BUTTONS.length; i += 4) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const def of PING_BUTTONS.slice(i, i + 4)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`role:toggle:${def.role}`)
          .setLabel(def.label)
          .setEmoji(def.emoji)
          .setStyle(ButtonStyle.Secondary),
      );
    }
    rows.push(row);
  }
  return rows;
}

export function buildAnnouncementsEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.muted)
    .setTitle('📢 Ankündigungen')
    .setDescription(
      [
        'Server-Updates, geplante Wartungen, Neuigkeiten vom Admin.',
        '',
        '**Read-only** — keine Diskussion hier.',
        '',
        '_Wichtige Änderungen werden mit einem Role-Ping gepostet. Wer nicht gepingt werden will: stumm-schalten._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  broadcasts' });
}

export function buildRequestsChannelEmbed(r: ChannelRefs): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.seerr)
    .setTitle('📝 Film oder Serie requesten')
    .setDescription('Beide Wege laden im gleichen System — Seerr ist nur schöner.')
    .addFields(
      {
        name: '🌐 Seerr (empfohlen)',
        value: 'Öffne dein Seerr-Frontend → Filme/Serien suchen → Request klicken → fertig. Admins kennen die URL.',
      },
      {
        name: '💬 Discord (schnell)',
        value:
          "Schreib hier rein: `Titel · Jahr · (TV/Movie)`\n\n_Beispiel:_ `Dune · 2021 · Movie`\n\nEin Admin legt es im Seerr an.",
      },
      {
        name: '🔎 Schon da?',
        value: '`/search movie <titel>` oder `/search show <titel>` → zeigt dir, ob Sonarr/Radarr das schon kennt.',
      },
      {
        name: '📍 Was passiert danach?',
        value: [
          `**1.** Admin approved → ${m(r.approvals, 'approvals')}`,
          `**2.** Release-Grab → ${m(r.grabs, 'grabs')}`,
          `**3.** Import fertig → ${m(r.imports, 'imports')}`,
          `**4.** Auf Plex verfügbar → ${m(r.newOnPlex, 'new-on-plex')}`,
          `**5.** Status-Update (🎉 available / 💥 failed / 🗑️ deleted) landet hier in diesem Channel`,
        ].join('\n'),
      },
    )
    .setFooter({ text: 'MagguuBot  ·  Seerr request pipeline' });
}

export function buildApprovalsChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.warn)
    .setTitle('⏳ Pending Approvals')
    .setDescription(
      [
        'Neue Seerr-Requests landen hier mit **Approve / Decline** Buttons.',
        '',
        '_Admin-only. Bei Click feuert der Bot eine Seerr-API, setzt den Request-Status und deaktiviert die Buttons._',
      ].join('\n'),
    )
    .addFields(
      { name: '✅ Approve', value: 'Sonarr/Radarr bekommen den Auftrag sofort', inline: true },
      { name: '❌ Decline', value: 'User wird informiert, kein Download', inline: true },
      { name: '📜 Audit', value: 'Jede Entscheidung wird geloggt', inline: true },
    )
    .setFooter({ text: 'MagguuBot  ·  admin decision queue' });
}

export function buildNewOnPlexChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.plex)
    .setTitle('✨ Neu auf Plex')
    .setDescription(
      [
        'Tautulli postet hier jedes Mal, wenn ein Titel importiert und indiziert wurde — inklusive Poster, Jahr und Kurzbeschreibung.',
        '',
        '_Direkt in die Plex-App → Neuheiten-Sektion._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  Tautulli recently-added' });
}

export function buildGrabsChannelEmbed(r: ChannelRefs): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle('📥 Grabs')
    .setDescription(
      'Sonarr / Radarr haben eine Release gefunden und an SABnzbd geschickt. Noch nicht auf Plex — erst nach dem Import.',
    )
    .addFields(
      { name: 'Was siehst du?', value: 'Titel · Jahr · Episode · Quality · Größe · Release-Group · Indexer' },
      { name: 'Was kommt danach?', value: `SAB lädt → ${m(r.imports, 'imports')} → Plex` },
      { name: 'Dauert zu lang?', value: '`/queue` zeigt live den Fortschritt mit Progress-Bar' },
    )
    .setFooter({ text: 'MagguuBot  ·  release grabbed' });
}

export function buildImportsChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.success)
    .setTitle('✅ Imports')
    .setDescription(
      [
        'Datei ist geschrieben, umbenannt, und in der Library — Plex sieht sie innerhalb von ~1 Minute.',
        '',
        '**🎬 Upgrade**: wenn Sonarr/Radarr ein besseres Release gefunden hat, steht hier _Upgraded_ im Titel.',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  ready to stream' });
}

export function buildFailuresChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.danger)
    .setTitle('⚠️ Failures & Issues')
    .setDescription('Alles was **admin-Aufmerksamkeit** braucht — Download-Probleme UND User-gemeldete Plex-Issues.')
    .addFields(
      { name: '`DownloadFailure`', value: 'SAB/qBit hat abgebrochen', inline: true },
      { name: '`ImportFailure`', value: 'Download ok, aber Import in die Library gescheitert', inline: true },
      { name: '`ManualInteractionRequired`', value: 'Sonarr/Radarr brauchen manuellen Import-Entscheid', inline: true },
      { name: '`SAB failed`', value: 'Post-Processing / par2 crashed', inline: true },
      { name: '🐛 Seerr Issues', value: 'User meldet Playback-Problem (Video/Audio/Subs) — inkl. Comments', inline: true },
      {
        name: 'Troubleshoot-Schritte',
        value: [
          '1. `/queue` — was hängt gerade?',
          '2. `/arr-status` — Service-Health auf einen Blick',
          '3. Logs: `docker logs sabnzbd --tail 100`',
          '4. Re-queue in Sonarr/Radarr via Activity → failed → Search again',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'MagguuBot  ·  needs attention' });
}

export function buildHealthChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.muted)
    .setTitle('🩺 Service-Health & Updates')
    .setDescription(
      [
        'Sonarr, Radarr und SABnzbd melden hier Warnungen + Versions-Updates:',
        '',
        '• Indexer offline / rate-limited',
        '• Disk space low',
        '• Download-Client unreachable',
        '• System-config-Mismatch',
        '• 🔄 Neue *arr-Version installiert (ApplicationUpdate)',
        '',
        '**🟡 Warning** → 24h beobachten · **🔴 Error** → sofort fixen · **🟢 Restored** → self-healed',
        '',
        '_Live-Snapshot jederzeit mit `/arr-status`._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  stack health' });
}

export function buildGeneralChatEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle('💬 General Chat')
    .setDescription(
      [
        'Willkommen im Herzen des Servers — hier wird gelabert, empfohlen, gezankt und gelacht.',
        '',
        '**Themen die immer gehen:**',
        '• Was kuckst du gerade?',
        '• Netflix hat schon wieder eine Serie abgesetzt',
        '• Release-Gruppen-Drama',
        '• Memes',
        '',
        '_Keine Spoiler ohne Tag. Keine Links zu Piraten-Quellen._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  plauder-zone' });
}

export function buildBotCommandsChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle('⌨️ Bot-Befehle hier')
    .setDescription(
      [
        'Damit die anderen Channels spam-frei bleiben, alle Slash-Commands bitte hier:',
        '',
        '• `/queue` — live Download-Status',
        '• `/search movie|show <titel>` — *arr-Lookup',
        '• `/rank` / `/leaderboard` — XP',
        '• `/userinfo` / `/serverinfo` / `/avatar` / `/botinfo`',
        '• `/poll` / `/remindme`',
        '',
        '_Für admin-only: `/announce` funktioniert auch hier — postet dann aber in den Ziel-Channel._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  /help für alles' });
}

export function buildModLogChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.danger)
    .setTitle('🛡️ Mod-Log')
    .setDescription('Alle Moderation-Actions für Transparenz. Gepflegt vom Bot, automatisch getaggt.')
    .addFields(
      { name: '⚠️ WARN', value: 'Verwarnung, wird gezählt', inline: true },
      { name: '🔇 TIMEOUT', value: 'Stumm für X Minuten', inline: true },
      { name: '👢 KICK', value: 'Rauswurf, kann wieder joinen', inline: true },
      { name: '🔨 BAN', value: 'Permanent gesperrt', inline: true },
      { name: '🕊️ UNBAN', value: 'Ban aufgehoben', inline: true },
      { name: '🧹 PURGE', value: 'Bulk-Delete im Channel', inline: true },
      { name: '🐌 SLOWMODE', value: 'Channel-Slowmode gesetzt', inline: true },
      { name: '🤖 AUTOMOD', value: 'Auto-gelöscht (Invite/Caps/Mention/Link/Phrase)', inline: true },
    )
    .setFooter({ text: 'MagguuBot  ·  moderation audit' });
}

export function buildAuditLogChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.muted)
    .setTitle('📋 Audit-Log')
    .setDescription('Wer ist joined / geleaved / hat neue Rollen bekommen.')
    .addFields(
      { name: '🟢 Joined', value: 'Mit Account-Alter und Member-Nummer', inline: true },
      { name: '⚪ Left', value: 'Mit Join-Datum', inline: true },
      { name: '🟣 Role-Changes', value: 'Hinzugefügt + entfernt', inline: true },
      {
        name: 'Nicht geloggt',
        value: 'Message-Edits/Deletes — `MessageContent`-Intent ist aus (Privacy-Default). Falls benötigt, im Code einschalten und Dev-Portal zustimmen.',
      },
    )
    .setFooter({ text: 'MagguuBot  ·  server audit' });
}

export function buildGithubChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle('🔨 GitHub-Feed')
    .setDescription('Live-Activity aus allen deinen Repos — push und vergessen, Bot postet hier.')
    .addFields(
      { name: '📦 Push', value: 'Commits mit Autor + SHA + Message', inline: true },
      { name: '✅❌ Workflow-Run', value: 'CI-Status + Link zum Failed-Log', inline: true },
      { name: '🏷️ Release', value: 'Neue Tags + Release-Notes', inline: true },
      { name: '🟢🔴🟣 Pull-Request', value: 'opened / closed / merged', inline: true },
      { name: '🐛 Issues', value: 'opened / closed / reopened (inkl. Body + Labels)', inline: true },
      {
        name: 'Setup per Repo',
        value:
          'GitHub → Repo → Settings → Webhooks → Add → URL `<bot-url>/webhook/github` · Content-Type `application/json` · Secret = `GITHUB_WEBHOOK_SECRET` · Events: Push, Workflow runs, Releases, Pull requests, **Issues**',
      },
    )
    .setFooter({ text: 'MagguuBot  ·  GitHub activity' });
}

export function buildPlexActivityChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.plex)
    .setTitle('🎬 Plex Activity')
    .setDescription(
      [
        'Live-Feed was gerade auf Plex läuft: wer was schaut, pausiert, weiter-guckt oder zu Ende gesehen hat.',
        '',
        '_Live-Stream-Counter siehst du außerdem im Voice-Channel **🎬 Plex: N** in der STATISTIK-Kategorie._',
      ].join('\n'),
    )
    .addFields(
      { name: '▶️ Play / Resume', value: 'Jemand startet oder setzt fort', inline: true },
      { name: '⏸️ Pause', value: 'Jemand hat pausiert', inline: true },
      { name: '⏹️ Stop / Watched', value: 'Stream beendet oder zu Ende', inline: true },
      {
        name: 'Setup in Tautulli',
        value:
          'Tautulli → Settings → **Notification Agents** → Add Webhook · URL `http://<unraid-ip>:3000/webhook/tautulli` mit Header `X-Magguu-Token` = WEBHOOK_SECRET · Triggers: Playback Start/Pause/Resume/Stop + Watched aktivieren',
      },
    )
    .setFooter({ text: 'MagguuBot · Plex activity + live stream count' });
}

export function buildMaintainerrChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.muted)
    .setTitle('🗑️ Gelöscht — Library Cleanup')
    .setDescription('Alles was aus der Library entfernt wurde — durch Maintainerr-Regel oder manuell in Sonarr/Radarr.')
    .addFields(
      { name: '🧹 Maintainerr Handled', value: 'Regel hat Medien gelöscht', inline: true },
      { name: '🗓️ Maintainerr Pending', value: 'kommt bald in die Delete-Queue', inline: true },
      { name: '↩️ Rule gone', value: 'Check greift nicht mehr', inline: true },
      { name: '🎬 Radarr MovieDelete', value: 'Film aus Radarr entfernt', inline: true },
      { name: '📺 Sonarr SeriesDelete', value: 'Serie komplett entfernt', inline: true },
      { name: '🗂️ File-Deletes', value: 'Einzelne Episode/Movie-Files weg', inline: true },
      {
        name: 'Setup in Maintainerr',
        value:
          'Maintainerr → **Settings → Notifications → Add Agent** · Agent `Discord` · Webhook URL `http://<unraid-ip>:3000/webhook/maintainerr` · Types: alle sechs ✅ · Speichern + Test-Connection',
      },
      {
        name: 'Setup in Sonarr/Radarr',
        value:
          '*arr → Settings → Connect → Webhook → Triggers: **On Movie/Series Delete** + **On Movie/Episode File Delete** ✅',
      },
    )
    .setFooter({ text: 'MagguuBot · library cleanup feed' });
}

export function buildStarboardChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.warn)
    .setTitle('⭐ Starboard — Highlights')
    .setDescription(
      [
        '**So funktioniert\'s:**',
        'Reagier mit ⭐ auf eine Nachricht — sobald **3 Leute** gesternt haben, landet eine Kopie hier.',
        '',
        'Bot-Messages zählen nicht. Self-Stars zählen nicht. Entfernst du deinen Stern, sinkt der Counter wieder.',
      ].join('\n'),
    )
    .addFields(
      { name: '⭐ Threshold', value: '3 Sterne', inline: true },
      { name: '✨ Update', value: 'Live — Count wird nachgezogen', inline: true },
      { name: '🧹 Aufräumen', value: 'Bei 0 Sternen wird der Eintrag gelöscht', inline: true },
    )
    .setFooter({ text: 'MagguuBot  ·  highlights curated by you' });
}

export function buildAddonUpdatesChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle('🎨 MagguuUI Addon — Updates')
    .setDescription(
      [
        'Neue Releases vom MagguuUI-Addon landen hier automatisch — mit Versionsnummer, Changelog und Download-Link.',
        '',
        '**Wie update ich?**',
        '• Classic-Art: entpackte Addon-Version ins `Interface/AddOns` verschieben und `/reload` in-game',
        '• Optional: via CurseForge / WowUp wenn der Release dort gelistet ist',
        '',
        '_Pre-releases werden gepostet aber **nicht gepingt**. Nur stabile Releases pingen @ping-github (Opt-in über `🎭・rollen`)._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  addon release feed' });
}

export function buildFaqChannelEmbed(r: ChannelRefs): EmbedBuilder {
  const addonRef = r.addonUpdates ? `<#${r.addonUpdates}>` : '**#🎨・addon-updates**';
  const rolesRef = r.roles ? `<#${r.roles}>` : '**#🎭・rollen**';
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setAuthor({ name: 'MagguuUI  ·  Addon & Homelab FAQ' })
    .setTitle('❓  Alles rund ums Addon')
    .setDescription(
      [
        'Willkommen in der MagguuUI-Community. Hier findest du alles um das Addon zu installieren, updaten und Feedback zu geben.',
        '',
        '**📦  Installation**',
        `1. Neueste Release-ZIP aus ${addonRef} laden`,
        '2. Datei entpacken → Ordner **`MagguuUI`** kopieren nach:',
        '   `World of Warcraft/_retail_/Interface/AddOns/`',
        '3. WoW starten → Character-Select → **AddOns** Button unten links → **MagguuUI ✅** aktivieren',
        '4. Falls UI nicht erscheint: ingame `/reload` eingeben',
        '',
        '**🔄  Updaten**',
        '- Alten `MagguuUI`-Ordner **komplett löschen**, dann neue ZIP rein',
        '- Nie „über die alte Version kopieren" — lässt verwaiste Dateien zurück',
        '- Einmal `/reload` nach WoW-Start',
        '',
        '**🐛  Bug melden**',
        '- GitHub Issue öffnen (Link in der README)',
        '- Oder im Server kurz posten — mit **WoW-Version**, **UI-Scale** und **Repro-Schritten**',
        '- Screenshots oder `/combatlog`-Output sehr hilfreich',
      ].join('\n'),
    )
    .addFields(
      {
        name: '❓  Häufige Fragen',
        value: [
          '`UI zu groß/klein?` → `/run SetCVar("uiScale", 0.85)` (0.7–1.0)',
          '`Classic-Support?` → Nein, nur Retail + PTR',
          '`ElvUI-Konflikt?` → Ja, eines von beiden nutzen',
          '`Nightly Builds?` → Pre-Releases werden gepostet, aber **nicht gepingt**',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🔔  Updates abonnieren',
        value: `Button **🎨 MagguuUI** in ${rolesRef} klicken — macht den Channel für dich sichtbar. Plus **🔨 GitHub** für Release-Pings.`,
        inline: false,
      },
      {
        name: '📝  Weitere FAQ',
        value: '`/tag list` zeigt alle serverweiten FAQ-Einträge. `/tag get name:<tag>` ruft einen ab. Admins erweitern via `/tag add`.',
        inline: false,
      },
    )
    .setFooter({ text: 'MagguuUI  ·  Community-driven FAQ' });
}

export function buildBlueTrackerChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x148ae3)
    .setTitle('📰 WoW Blue-Tracker')
    .setDescription(
      [
        'Automatischer Feed der aktuellen **Blizzard Blue-Posts** — nur Retail + PTR.',
        '',
        'Class Tunings, Hotfixes, Balance-Changes, offizielle Ankündigungen der Community-Manager.',
        '',
        '_Classic / SoD / Wrath / Cataclysm werden gefiltert — nur die Live-Version interessiert uns._',
      ].join('\n'),
    )
    .addFields(
      { name: '⏱ Poll-Intervall', value: '15 Minuten', inline: true },
      { name: '🔵 Quelle', value: 'WoW-Forum Blue-Tracker (RSS)', inline: true },
      { name: '🎯 Scope', value: 'Retail + PTR only', inline: true },
    )
    .setFooter({ text: 'MagguuBot  ·  Blue-Tracker' });
}

export function buildSuggestionsChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.suggestion)
    .setTitle('💡 Vorschläge')
    .setDescription(
      [
        'Hier landen alle Vorschläge der Community — von kleinen QoL-Wünschen bis großen Feature-Ideen.',
        '',
        '**So gehts:**',
        '• `/suggest <text>` — schickt deinen Vorschlag mit Vote-Buttons in diesen Channel',
        '• 👍 / 👎 — andere voten, du selbst kannst nicht für deinen eigenen voten',
        '• Status-Updates: 💡 Offen → 🛠️ In Arbeit → ✅ Angenommen oder ❌ Abgelehnt',
        '',
        '_Bei "Angenommen" und "Abgelehnt" wird Voting geschlossen. Admins ändern Status via `/suggestion-status`._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  community feedback' });
}

export function buildSpoilerChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.danger)
    .setTitle('🔇 Spoiler-Zone')
    .setDescription(
      [
        '**Hier ist alles erlaubt** — Staffel-Finales, Plot-Twists, wer stirbt.',
        '',
        '_Kein ||Tag|| nötig. Wenn du nicht verspoilert werden willst: einfach diesen Channel muten._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  enter at your own risk' });
}
