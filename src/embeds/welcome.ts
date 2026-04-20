import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Colors } from './colors.js';

const DIVIDER = '─────────────────────';

export interface ChannelRefs {
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
        'Dein privater **Downloads + Plex**-Hub.',
        '',
        'Hier siehst du live was passiert: neue Requests, Grabs, abgeschlossene Downloads, Fehler und Plex-Arrivals.',
        '',
        DIVIDER,
        '**🚀 In 3 Schritten startklar**',
        '',
        `**1.** Les die Regeln in ${m(r.rules, 'regeln')}`,
        `**2.** Hol dir Benachrichtigungs-Rollen in ${m(r.roles, 'rollen')}`,
        `**3.** Request deinen ersten Film / deine Serie in ${m(r.requests, 'requests')}`,
        '',
        DIVIDER,
        '**🔗 Nützliche Links**',
        '',
        '• [Plex-Bibliothek öffnen](https://app.plex.tv)',
        `• [Status aller Services](https://ui.magguu.xyz)`,
        `• Alle Bot-Befehle in ${m(r.botHelp, 'bot-hilfe')}`,
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  powered by Sonarr / Radarr / Seerr / SABnzbd / Tautulli' })
    .setTimestamp(new Date());
}

export function buildRulesEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.warn)
    .setTitle('📜 Server-Regeln')
    .setDescription(
      [
        'Damit alle Spaß haben — kurz und knackig:',
        '',
        '**1. Respekt** — keine Beleidigungen, kein Rassismus, kein Drama.',
        '**2. Keine Spoiler** ohne Spoiler-Tag (`||Spoiler||`) — oder geh ins Spoiler-Channel.',
        '**3. Keine Piraterie-Links** — Requests laufen ausschließlich über Seerr.',
        '**4. Ein Thema pro Channel** — Downloads ins Downloads-Channel, Chat ins Chat-Channel.',
        '**5. Admin-Entscheidungen sind final** — Widerspruch bitte per DM.',
        '',
        DIVIDER,
        '',
        '_Stufen bei Regelverstößen: **Warnung** → **Timeout** → **Kick** → **Ban**._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  be nice' });
}

export function buildBotHelpEmbed(r: ChannelRefs): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle('🤖 Bot-Befehle')
    .setDescription('Slash-Commands — tipp einfach `/` in irgendeinen Channel.')
    .addFields(
      {
        name: '📥 `/queue`',
        value: 'Live-Snapshot deiner Downloads: Sonarr + Radarr + SABnzbd mit Progress-Bar.',
      },
      {
        name: '🔍 `/search movie <query>`',
        value: 'Sucht in Radarr nach einem Film und zeigt Top-5 Treffer.',
      },
      {
        name: '🔍 `/search show <query>`',
        value: 'Sucht in Sonarr nach einer Serie und zeigt Top-5 Treffer.',
      },
      {
        name: '🛠️ `/setup-server`',
        value: 'Nur Admins. Baut alle Kategorien, Channels, Rollen, Welcome-Banner. Idempotent.',
      },
      {
        name: '\u200b',
        value: [
          DIVIDER,
          '**Automatische Posts vom Bot**',
          `• Release grabs → ${m(r.grabs, 'grabs')}`,
          `• Fertige Imports → ${m(r.imports, 'imports')}`,
          `• Fehler / manuelle Eingriffe → ${m(r.failures, 'failures')}`,
          `• Neue Seerr-Requests (mit Buttons) → ${m(r.approvals, 'approvals')}`,
          `• Neu auf Plex → ${m(r.newOnPlex, 'new-on-plex')}`,
          `• Service-Health → ${m(r.health, 'health')}`,
        ].join('\n'),
      },
    )
    .setFooter({ text: 'MagguuBot  ·  /queue is your friend' });
}

export function buildRolePickerEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.seerr)
    .setTitle('🎭 Deine Benachrichtigungen')
    .setDescription(
      [
        'Wähle wovon du gepingt werden willst. Klick auf einen Button — die Rolle wird an/aus-getogglet.',
        '',
        DIVIDER,
        '',
        '🎬 **Film-Alerts** — Ping bei neuen Film-Grabs / -Imports',
        '📺 **Serien-Alerts** — Ping bei neuen Episoden',
        '🔊 **4K-Alerts** — Ping nur bei 2160p-Releases',
        '',
        DIVIDER,
        '',
        '_Jederzeit änderbar — einfach nochmal klicken._',
      ].join('\n'),
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
      'Server-Updates, geplante Wartungen, Mitteilungen vom Admin. Read-only — keine Diskussion hier, dafür sind andere Channels da.',
    )
    .setFooter({ text: 'MagguuBot' });
}

export function buildRequestsChannelEmbed(r: ChannelRefs): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.seerr)
    .setTitle('📝 Film / Serie requesten')
    .setDescription(
      [
        'Zwei Wege, beide gehen zur selben Queue:',
        '',
        '**🌐 Über Seerr** — der schöne Weg mit Postern und Trailern',
        '',
        '**💬 Hier in Discord** — schreib Titel + Jahr, ein Admin legt es an',
        '',
        DIVIDER,
        '',
        `✅ Genehmigte Requests erscheinen in ${m(r.approvals, 'approvals')}`,
        `📥 Sobald verfügbar, poppen sie in ${m(r.imports, 'imports')} und ${m(r.newOnPlex, 'new-on-plex')} auf`,
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  Seerr request pipeline' });
}

export function buildApprovalsChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.warn)
    .setTitle('⏳ Pending Approvals')
    .setDescription(
      [
        'Neue Seerr-Requests landen hier mit **Approve / Decline**-Buttons.',
        '',
        '_Admin-only. Bei Click ruft der Bot Seerr auf, setzt den Request-Status, deaktiviert die Buttons._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  admin decision queue' });
}

export function buildNewOnPlexChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.plex)
    .setTitle('✨ Neu auf Plex')
    .setDescription(
      'Tautulli postet hier automatisch jedes Mal, wenn ein Titel importiert und indiziert wurde — inklusive Poster und Kurzbeschreibung.',
    )
    .setFooter({ text: 'MagguuBot  ·  Tautulli recently-added' });
}

export function buildGrabsChannelEmbed(r: ChannelRefs): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle('📥 Grabs')
    .setDescription(
      [
        'Sonarr / Radarr haben eine Release gefunden und an SABnzbd übergeben. Hier siehst du:',
        '',
        '• Titel + Jahr + Episode',
        '• Qualität (1080p, 2160p, …)',
        '• Größe + Release-Group + Indexer',
        '',
        `_Nach erfolgreichem Download wandert das Ganze nach ${m(r.imports, 'imports')}._`,
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  release grabbed' });
}

export function buildImportsChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.success)
    .setTitle('✅ Imports')
    .setDescription(
      'Fertig importierte Dateien — von Sonarr, Radarr oder SABnzbd. In ~1 Minute in Plex verfügbar.',
    )
    .setFooter({ text: 'MagguuBot  ·  ready to stream' });
}

export function buildFailuresChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.danger)
    .setTitle('⚠️ Failures')
    .setDescription(
      [
        'Etwas lief schief:',
        '',
        '• **DownloadFailure** — SAB hat nicht fertig bekommen',
        '• **ManualInteractionRequired** — Sonarr/Radarr brauchen manuelle Hilfe',
        '• **Failed** — SABnzbd Post-Processing fehlgeschlagen',
        '',
        '_Admin schaut rein, fixt, Release wird neu angestoßen._',
      ].join('\n'),
    )
    .setFooter({ text: 'MagguuBot  ·  needs attention' });
}

export function buildHealthChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.muted)
    .setTitle('🩺 Service-Health')
    .setDescription(
      'Sonarr, Radarr und SABnzbd melden hier Warnungen (Indexer down, Disk full, etc.). Read-only — der Admin triageiert.',
    )
    .setFooter({ text: 'MagguuBot  ·  stack health' });
}

export function buildGeneralChatEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle('💬 General')
    .setDescription(
      'Hier labert sich\'s frei — was kuckst du gerade? Empfehlungen? Bugs? Alles willkommen.',
    )
    .setFooter({ text: 'MagguuBot' });
}

export function buildBotCommandsChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle('⌨️ Bot-Befehle ausführen')
    .setDescription(
      'Für Slash-Commands wie `/queue` oder `/search` — hält andere Channels spam-frei.',
    )
    .setFooter({ text: 'MagguuBot  ·  /queue · /search · /setup-server' });
}

export function buildSpoilerChannelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.danger)
    .setTitle('🔇 Spoiler-Zone')
    .setDescription(
      'Hier ist Spoiler-Talk erlaubt — ohne Warnung, ohne ||Tags||. Betretten auf eigene Gefahr.',
    )
    .setFooter({ text: 'MagguuBot  ·  enter at your own risk' });
}
