import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Colors } from './colors.js';

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
          '• [Service-Dashboard](https://ui.magguu.xyz)',
          '• [Seerr-Requests](https://seerr.magguu.xyz)',
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
    .setDescription('Tipp `/` in irgendeinen Channel für Autocomplete. `/help` zeigt die volle Liste.')
    .addFields(
      {
        name: '📥 Downloads',
        value: [
          '`/queue` — Sonarr+Radarr+SAB live queue',
          '`/search movie <query>` — Radarr-Lookup',
          '`/search show <query>` — Sonarr-Lookup',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🎮 Utility',
        value: [
          '`/help` — alle Commands',
          '`/rank` [user] — XP + Level',
          '`/leaderboard` — Top 10',
          '`/remindme <zeit> <text>` — DM-Reminder',
          '`/poll <frage> <optionen>` — Reaction-Poll',
          '`/userinfo` `/serverinfo` `/avatar` `/botinfo`',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🛡️ Moderation (gated)',
        value: '`/warn` `/timeout` `/kick` `/ban` `/unban` `/purge` — alles geloggt im Mod-Log',
        inline: false,
      },
      {
        name: '⚙️ Admin',
        value: [
          '`/announce` — styled Embed in einen Channel',
          '`/setup-server` — Struktur neu aufbauen/sortieren',
          '`/cleanup-server` — Orphan-Channels löschen (mit Confirm)',
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
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'MagguuBot  ·  20 Commands, 4 Kategorien' })
    .setTimestamp(new Date());
}

export function buildRolePickerEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.seerr)
    .setTitle('🎭 Deine Benachrichtigungen')
    .setDescription(
      [
        'Wähle wofür du gepingt werden willst. Klick auf einen Button — toggelt an/aus.',
        '',
        '_Rang-Rollen (Newcomer/Regular/VIP) vergibt der Bot automatisch nach Aktivität._',
      ].join('\n'),
    )
    .addFields(
      { name: '🎬 Film-Alerts', value: 'Ping bei neuen Movie-Grabs + Imports', inline: true },
      { name: '📺 Serien-Alerts', value: 'Ping bei neuen Episoden', inline: true },
      { name: '🔊 4K-Alerts', value: 'Ping nur bei 2160p-Releases', inline: true },
    )
    .setFooter({ text: 'MagguuBot  ·  opt-in, opt-out, alles chill' });
}

export function buildRolePickerButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('role:toggle:ping-movies')
      .setLabel('Film-Alerts')
      .setEmoji('🎬')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('role:toggle:ping-series')
      .setLabel('Serien-Alerts')
      .setEmoji('📺')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('role:toggle:ping-4k')
      .setLabel('4K-Alerts')
      .setEmoji('🔊')
      .setStyle(ButtonStyle.Primary),
  );
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
        value: '[seerr.magguu.xyz öffnen](https://seerr.magguu.xyz) · Filme/Serien suchen · Request klicken · fertig.',
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
    .setTitle('⚠️ Failures')
    .setDescription('Hier landen Downloads/Imports die **manuellen Eingriff** brauchen.')
    .addFields(
      { name: '`DownloadFailure`', value: 'SAB oder qBit hat nicht fertiggebracht', inline: true },
      { name: '`ManualInteractionRequired`', value: 'Sonarr/Radarr können Release nicht importieren', inline: true },
      { name: '`SAB failed`', value: 'Post-Processing crashed / par2 failed', inline: true },
      {
        name: 'Troubleshoot-Schritte',
        value: [
          '1. `/queue` — was hängt gerade?',
          '2. Logs: `docker logs sabnzbd --tail 100`',
          '3. Re-queue in Sonarr/Radarr via Activity → failed → Search again',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'MagguuBot  ·  needs attention' });
}

export function buildHealthChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.muted)
    .setTitle('🩺 Service-Health')
    .setDescription(
      [
        'Sonarr, Radarr und SABnzbd melden hier Warnungen:',
        '',
        '• Indexer offline / rate-limited',
        '• Disk space low',
        '• Download-Client unreachable',
        '• System-config-Mismatch',
        '',
        '**🟡 Warning** → 24h beobachten · **🔴 Error** → sofort fixen · **🟢 Restored** → self-healed',
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
      {
        name: 'Setup per Repo',
        value:
          'GitHub → Repo → Settings → Webhooks → Add → URL `<bot-url>/webhook/github` · Content-Type `application/json` · Secret = `GITHUB_WEBHOOK_SECRET` · Events: Push, Workflow runs, Releases, Pull requests',
      },
    )
    .setFooter({ text: 'MagguuBot  ·  GitHub activity' });
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
