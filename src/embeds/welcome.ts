import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Colors, FOOTER_ICONS } from './colors.js';
import { PING_ROLE_BUTTONS } from '../discord/server-layout.js';

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
  blizzard?: string;
  addonUpdates?: string;
  faq?: string;
  suggestions?: string;
  weeklyDigest?: string;
  downloadLive?: string;
  movieNight?: string;
  ticketLogs?: string;
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
        'Hier landet alles, was in meinem Stack passiert: neue Requests, Grabs von Sonarr/Radarr, Downloads über SABnzbd, Plex-Arrivals und GitHub-Pushes.',
      ].join('\n'),
    )
    .addFields(
      {
        name: '🚀 Quick-Start',
        value: [
          `**1.** Regeln lesen → ${m(r.rules, '👋・willkommen')}`,
          `**2.** Ping-Rollen holen → Buttons unten in ${m(r.roles, '👋・willkommen')}`,
          `**3.** Erste Anfrage → ${m(r.requests, 'requests')}`,
          '**4.** Commands entdecken → `/help`',
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
          '• `/plex-now-playing` — wer schaut gerade',
          '• `/rank` — dein Server-Level',
          '• `/remindme 2h Film` — DM-Reminder',
        ].join('\n'),
        inline: true,
      },
    )
    .setFooter({ text: 'MagguuBot  ·  Sonarr / Radarr / Seerr / SABnzbd / Tautulli', iconURL: FOOTER_ICONS.bot })
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
        value: 'Packt sie in `||Spoiler-Tags||` oder in einen Thread in `#💬・chat`.',
      },
      {
        name: '3️⃣ Keine Piraterie',
        value: 'Keine Download-Links, keine Torrents, keine NZBs. Requests laufen ausschließlich über Seerr.',
      },
      {
        name: '4️⃣ Ein Thema → Ein Channel',
        value: 'Download-Fragen in den Downloads-Channel, Smalltalk in den Chat. Admins verschieben sonst.',
      },
      {
        name: '5️⃣ Admin hat das letzte Wort',
        value: 'Requests können abgelehnt werden. Widerspruch per DM, nicht im Channel.',
      },
      {
        name: '⚠️ Verstöße',
        value: '`Warnung` → `Timeout` → `Kick` → `Ban`. Sichtbar im Mod-Log für Transparenz.',
      },
    )
    .setFooter({ text: 'MagguuBot  ·  Regeln v1', iconURL: FOOTER_ICONS.bot })
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
          '`/queue` — Sonarr+Radarr live Queue',
          '`/arr-status` — Service-Health + Disk-Space + Versionen',
          '`/search movie <query>` — Radarr-Lookup',
          '`/search show <query>` — Sonarr-Lookup',
          '`/calendar` — kommende Releases',
          '`/plex-top` — Top Filme/Serien/User aus Tautulli',
          '`/plex-now-playing` — aktuelle Streams',
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
          '`/movie-night` — Filmabend planen und abstimmen',
          '`/wrapped` — dein Jahresrückblick',
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
          '`/cleanup-server` — fremde Kanäle ins 🗄️ ARCHIV (löscht nichts)',
          '`/doctor` — Config, Channels, Permissions, Dienste prüfen',
          '`/downloads-live` — Live-Downloadkarte ein/aus',
          '`/tag add|edit|delete` — Custom-Text-Antworten',
          '`/autoresponder` — Pattern-Trigger-Autoreplies',
          '`/schedule-announce` — geplante Posts (mit Wiederholung)',
          '`/sticky set|remove` — Sticky-Messages pro Channel',
          '`/ticket-panel` — Support-Tickets via Button',
          '`/db-backup` `/db-restore` — SQLite-Snapshot',
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
          `• Plex-Aktivität → ${m(r.plexActivity, 'aktivität')}`,
          `• Health → ${m(r.health, 'health')}`,
          `• GitHub → ${m(r.github, 'github')}`,
          `• Welcome-Card → ${m(r.welcome, 'welcomen')} (gerendertes PNG bei Join)`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'MagguuBot  ·  /help für die volle Liste mit Kategorien', iconURL: FOOTER_ICONS.bot })
    .setTimestamp(new Date());
}

export function buildRolePickerEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle('Ping-Rollen')
    .setDescription(
      [
        '**MAGGUU · PINGS**',
        'Ein Klick schaltet die Rolle an oder aus. Du wirst nur gepingt, wenn etwas Passendes kommt.',
        '',
        PING_ROLE_BUTTONS.map((b) => `${b.emoji} ${b.label}`).join(' · '),
        '',
        '_Regular vergibt der Bot nach Aktivität. Plex-User vergibt ein Admin._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot · ui.magguu.xyz', iconURL: FOOTER_ICONS.bot });
}

/** The single role-button set (welcome channel panel and join DM). */
export function buildRolePickerButtons(): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < PING_ROLE_BUTTONS.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const def of PING_ROLE_BUTTONS.slice(i, i + 3)) {
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
    .setFooter({ text: 'MagguuBot  ·  broadcasts', iconURL: FOOTER_ICONS.bot });
}

export function buildRequestsChannelEmbed(r: ChannelRefs): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.seerr)
    .setTitle('📝 Film oder Serie requesten')
    .setDescription('Beide Wege landen im gleichen System — Seerr ist die empfohlene Oberfläche.')
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
    .setFooter({ text: 'MagguuBot  ·  Seerr request pipeline', iconURL: FOOTER_ICONS.bot });
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
    .setFooter({ text: 'MagguuBot  ·  admin decision queue', iconURL: FOOTER_ICONS.bot });
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
    .setFooter({ text: 'MagguuBot  ·  Tautulli recently-added', iconURL: FOOTER_ICONS.bot });
}

export function buildHealthChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.muted)
    .setTitle('🩺 Service-Health & Updates')
    .setDescription(
      [
        'Sonarr, Radarr und Prowlarr melden hier Warnungen + Versions-Updates:',
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
    .setFooter({ text: 'MagguuBot  ·  stack health', iconURL: FOOTER_ICONS.bot });
}

export function buildGeneralChatEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle('💬 General Chat')
    .setDescription(
      [
        'Allgemeiner Chat — Empfehlungen, Diskussionen und Smalltalk.',
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
    .setFooter({ text: 'MagguuBot  ·  Community-Chat', iconURL: FOOTER_ICONS.bot });
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
        '• `/plex-now-playing` — aktuelle Plex-Streams',
        '• `/search movie|show <titel>` — *arr-Lookup',
        '• `/rank` / `/leaderboard` — XP',
        '• `/movie-night` — Filmabend',
        '• `/userinfo` / `/serverinfo` / `/avatar` / `/botinfo`',
        '• `/poll` / `/remindme`',
        '',
        '_Für admin-only: `/announce` funktioniert auch hier — postet dann aber in den Ziel-Channel._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  /help für alles', iconURL: FOOTER_ICONS.bot });
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
    .setFooter({ text: 'MagguuBot  ·  moderation audit', iconURL: FOOTER_ICONS.bot });
}

export function buildPlexActivityChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.plex)
    .setTitle('🎬 Plex Activity')
    .setDescription(
      [
        'Live-Feed der aktuellen Plex-Sessions: wer was schaut, pausiert, fortsetzt oder zu Ende gesehen hat.',
        '',
        'Pausierte oder feststeckende Sessions (oft Fire TV im Hintergrund) beendet der Bot nach **20 Minuten** automatisch. Live-Stand jederzeit mit `/plex-now-playing`.',
      ].join('\n'),
    )
    .addFields(
      { name: '▶️ Play / Resume', value: 'Jemand startet oder setzt fort', inline: true },
      { name: '⏸️ Pause', value: 'Karte wechselt nach 2 Minuten Pause', inline: true },
      { name: '⏹️ Stop / Watched', value: 'Stream beendet oder zu Ende', inline: true },
      {
        name: 'Setup in Tautulli',
        value:
          'Tautulli → Settings → **Notification Agents** → Add Webhook · URL `http://<unraid-ip>:3000/webhook/tautulli` mit Header `X-Magguu-Token` = WEBHOOK_SECRET · Triggers: Playback Start/Pause/Resume/Stop + Watched + Recently Added (`created`) + Error',
      },
    )
    .setFooter({ text: 'MagguuBot · Plex activity + live stream count', iconURL: FOOTER_ICONS.bot });
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
        '• Am einfachsten über CurseForge oder Wago aktualisieren (WowUp zieht von dort mit)',
        '• Manuell: ZIP entpacken und die **vier** Ordner (`MagguuUI`, `MagguuUI_Data`, `MagguuUI_EUI`, `MagguuUI_Media`) in `Interface/AddOns` ersetzen — alle aktiviert lassen',
        '• Danach WoW neu starten oder `/reload` — Ellesmere-Startpopup wird übersprungen. `/mui` Setup: **Magguu-Profile übernehmen** (Profile + Magguu Settings + Begleiter; Edit Mode MagguuUI einmal; Window & Tooltip Skins Precheck), **Magguu Settings** (nur Overlay/QoL) | **Profile laden** (aktiviert nur, außer Klassenlayouts; kein Neuimport). Scale `0.58` kommt mit Magguu-Profile übernehmen / Magguu Settings',
        '',
        '_Pre-releases werden gepostet aber **nicht gepingt**. Nur stabile Releases pingen @ping-magguuui (Opt-in über die Buttons in `👋・willkommen`)._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  addon release feed', iconURL: FOOTER_ICONS.bot });
}

export function buildFaqChannelEmbed(r: ChannelRefs): EmbedBuilder {
  const addonRef = r.addonUpdates ? `<#${r.addonUpdates}>` : '**#📰・updates**';
  const rolesRef = r.roles ? `<#${r.roles}>` : '**#👋・willkommen**';
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setAuthor({ name: 'MagguuUI  ·  Addon & Homelab FAQ' })
    .setTitle('❓  Alles rund ums Addon')
    .setDescription(
      [
        'MagguuUI sitzt in **EllesmereUI** (Ready for WoW **12.1**, läuft weiter auf Midnight **12.0**). Öffnen mit `/mui`. Sidebar: **Optionen** (Setup / Skinning / QoL) und **Changelog**. Werkzeuge bleiben versteckt (`/mui tools` oder Header **10×**). UI in **11 Client-Sprachen**.',
        '',
        '**📦  Installation**',
        '1. **EllesmereUI** 9.0.6+ installieren und aktivieren (CurseForge / Wago / WowUp)',
        `2. Neueste MagguuUI-ZIP aus ${addonRef} laden und entpacken`,
        '3. Die **vier** Addon-Ordner nach `World of Warcraft/_retail_/Interface/AddOns/` legen:',
        '   `MagguuUI`, `MagguuUI_Data` ([Data]), `MagguuUI_EUI` ([EUI]), `MagguuUI_Media` ([Media]) — alle vier aktiviert lassen',
        '4. Character-Select → AddOns → alle vier MagguuUI-Addons plus EllesmereUI aktiviert lassen',
        '5. Einloggen: Ellesmere-Startpopup wird übersprungen, Magguu-Setup öffnet sich. `/mui` → **Setup**: goldenes **Magguu-Profile übernehmen** (Profile + Magguu Settings + Begleiter; Edit Mode **MagguuUI** einmal; Window & Tooltip Skins Precheck), dann **Magguu Settings** (nur Overlay/QoL) | **Profile laden** (nur aktivieren, außer Klassenlayouts; kein Neuimport). Scale `0.58` kommt mit Magguu-Profile übernehmen / Magguu Settings (kein eigener Scale-Button). WowUp-Packs dort kopieren. Auf einem Alt erscheint ein Popup zum Laden der Profile',
        '',
        '**🔄  Updaten**',
        '- Über den Addon-Manager reicht **Aktualisieren**',
        '- Manuell die vier MagguuUI-Ordner aus der ZIP ersetzen — `MagguuUI_Data` nicht löschen',
        '- Danach `/reload` oder `/mui`',
        '',
        '**🐛  Bug melden**',
        '- [GitHub Issue öffnen](https://github.com/Derpsen/MagguuUI/issues)',
        '- Oder im Server posten mit **WoW-Version**, **UI-Scale** und **Repro-Schritten**',
      ].join('\n'),
    )
    .addFields(
      {
        name: '📦  WowUp-Packs',
        value: [
          'Im Setup kopieren und in WowUp einfügen.',
          '**Starter:** EllesmereUI, MagguuUI, BigWigs, LittleWigs, Northern Sky, EXBoss, EXCore',
          '**Optional:** BugGrabber, BugSack, HandyNotes, HandyNotes MapNotes, MDT, Raider.IO, Simulationcraft, Talent Tree Tweaks, Whisper Messenger, Waypoint UI, GTFO, Premade Groups Filter, Auctionator, Smart Reminders',
        ].join('\n'),
        inline: false,
      },
      {
        name: '❓  Häufige Fragen',
        value: [
          '`UI-Skalierung?` → `0.58` über Magguu-Profile übernehmen / Magguu Settings',
          '`Tooltip?` → Magguus Platz, folgt nicht der Maus',
          '`WoW-Version?` → Ready for **12.1**; lädt auf Midnight **12.0**',
          '`Was brauche ich?` → EllesmereUI 9.0.6+ + MagguuUI (vier Ordner, alle aktiviert)',
          '`Setup?` → Magguu-Profile übernehmen = Profile+Settings+Begleiter (Waypoint/HandyNotes/TTT/GTFO/BugSack/PGF). Magguu Settings = Overlay/QoL. Profile laden nur aktivieren (kein Neuimport). Setup-Buttons BigWigs/NSRT/EXBoss/Smart Reminders/Whisper Messenger (Flüster-Chat). WowUp PGF+Auctionator+Smart Reminders+MapNotes',
          '`Skinning?` → NAMEN & FARBEN DualRow (Unit | Party/Raid) + klassenfarbige Keybinds — Magguu Settings',
          '`QoL?` → Death-Release, Co-Tank, Stealth/Stance, Spell-Alerts, Itemlevel Party/Raid (2P/4P), Smart Tab, Quick Focus, Ellesmere-Lautsprecher, Boiling Point; AuraBuff-Count CENTER. Targeted Spell Bars ON; EXBoss MythicCast OFF. Kein TopBar/Hearth/Magguu-FPS',
          '`Nightly Builds?` → Pre-Releases gepostet, **nicht gepingt**',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🔔  Updates abonnieren',
        value: `Button **🎨 MagguuUI** in ${rolesRef} klicken — schaltet den Channel frei. Zusätzlich **🔨 GitHub** für Release-Pings.`,
        inline: false,
      },
      {
        name: '📝  Weitere FAQ',
        value: '`/tag list` zeigt alle serverweiten FAQ-Einträge. `/tag get name:<tag>` ruft einen ab.',
        inline: false,
      },
    )
    .setFooter({ text: 'MagguuUI  ·  Addon & Homelab FAQ', iconURL: FOOTER_ICONS.bot });
}

export function buildDownloadLiveChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle('📡 Live-Downloads')
    .setDescription(
      [
        'Eine Karte für Sonarr, Radarr und SABnzbd — aktualisiert sich jede Minute.',
        '',
        'Admin: `/downloads-live enable|refresh|disable`',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  live queue card', iconURL: FOOTER_ICONS.bot });
}

export function buildMovieNightChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.plex)
    .setTitle('🎬 Movie-Night')
    .setDescription(
      [
        'Filmabend planen, Filme nominieren und abstimmen.',
        '',
        '• `/movie-night create` — neue Runde (Admin)',
        '• `/movie-night nominate` — Film vorschlagen',
        '• `/movie-night status` — aktueller Stand',
        '',
        '_Voice dafür: 🎬 Movie Night._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  movie night', iconURL: FOOTER_ICONS.bot });
}

export function buildSuggestionsChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.suggestion)
    .setTitle('💡 Vorschläge')
    .setDescription(
      [
        'Hier landen alle Vorschläge der Community — von kleinen QoL-Wünschen bis großen Feature-Ideen.',
        '',
        "**So geht's:**",
        '• `/suggest <text>` — schickt deinen Vorschlag mit Vote-Buttons in diesen Channel',
        '• 👍 / 👎 — andere voten, du selbst kannst nicht für deinen eigenen voten',
        '• Status-Updates: 💡 Offen → 🛠️ In Arbeit → ✅ Angenommen oder ❌ Abgelehnt',
        '',
        '_Bei "Angenommen" und "Abgelehnt" wird Voting geschlossen. Admins ändern Status via `/suggestion-status`._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  community feedback', iconURL: FOOTER_ICONS.bot });
}
