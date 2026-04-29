import { z } from 'zod';

// Webhook payloads from upstream services drift between versions and contain
// many optional fields. The schemas below enforce the *shape we depend on* —
// a discriminator field is required, and the obvious nested objects are
// described — but everything else is `.passthrough()` so a benign upstream
// change does not break the bot. The point is to reject malformed/empty
// bodies and to satisfy `noUncheckedIndexedAccess` without hand-rolled casts.

// ─── Sonarr ─────────────────────────────────────────

const sonarrEpisode = z
  .object({
    seasonNumber: z.number(),
    episodeNumber: z.number(),
    title: z.string().optional(),
  })
  .passthrough();

const sonarrEpisodeFile = z
  .object({
    quality: z.string().optional(),
    size: z.number().optional(),
    releaseGroup: z.string().optional(),
    path: z.string().optional(),
  })
  .passthrough();

export const sonarrPayloadSchema = z
  .object({
    eventType: z.string().min(1),
    series: z
      .object({
        title: z.string(),
        year: z.number().optional(),
        path: z.string().optional(),
        images: z
          .array(z.object({ coverType: z.string(), remoteUrl: z.string().optional() }).passthrough())
          .optional(),
      })
      .passthrough()
      .optional(),
    episodes: z.array(sonarrEpisode).optional(),
    release: z
      .object({
        quality: z.string().optional(),
        size: z.number().optional(),
        releaseGroup: z.string().optional(),
        releaseTitle: z.string().optional(),
        indexer: z.string().optional(),
      })
      .passthrough()
      .optional(),
    episodeFile: sonarrEpisodeFile.optional(),
    episodeFiles: z.array(sonarrEpisodeFile).optional(),
    deletedFiles: z.boolean().optional(),
    downloadClient: z.string().optional(),
    isUpgrade: z.boolean().optional(),
    level: z.enum(['ok', 'warning', 'error']).optional(),
    message: z.string().optional(),
    type: z.string().optional(),
    instanceName: z.string().optional(),
    previousVersion: z.string().optional(),
    newVersion: z.string().optional(),
  })
  .passthrough();

export type SonarrPayload = z.infer<typeof sonarrPayloadSchema>;

// ─── Radarr ─────────────────────────────────────────

const radarrMovieFile = z
  .object({
    quality: z.string().optional(),
    size: z.number().optional(),
    releaseGroup: z.string().optional(),
    path: z.string().optional(),
  })
  .passthrough();

export const radarrPayloadSchema = z
  .object({
    eventType: z.string().min(1),
    movie: z
      .object({
        title: z.string(),
        year: z.number().optional(),
        path: z.string().optional(),
        images: z
          .array(z.object({ coverType: z.string(), remoteUrl: z.string().optional() }).passthrough())
          .optional(),
      })
      .passthrough()
      .optional(),
    remoteMovie: z
      .object({ title: z.string().optional(), year: z.number().optional() })
      .passthrough()
      .optional(),
    release: z
      .object({
        quality: z.string().optional(),
        size: z.number().optional(),
        releaseGroup: z.string().optional(),
        releaseTitle: z.string().optional(),
        indexer: z.string().optional(),
      })
      .passthrough()
      .optional(),
    movieFile: radarrMovieFile.optional(),
    deletedFiles: z.boolean().optional(),
    downloadClient: z.string().optional(),
    isUpgrade: z.boolean().optional(),
    level: z.enum(['ok', 'warning', 'error']).optional(),
    message: z.string().optional(),
    type: z.string().optional(),
    instanceName: z.string().optional(),
    previousVersion: z.string().optional(),
    newVersion: z.string().optional(),
  })
  .passthrough();

export type RadarrPayload = z.infer<typeof radarrPayloadSchema>;

// ─── Seerr (Overseerr / Jellyseerr) ─────────────────

export const seerrPayloadSchema = z
  .object({
    notification_type: z.string().min(1),
    event: z.string().optional(),
    subject: z.string().optional(),
    message: z.string().optional(),
    image: z.string().optional(),
    media: z
      .object({
        media_type: z.enum(['movie', 'tv']).optional(),
        tmdbId: z.union([z.string(), z.number()]).optional(),
        status: z.string().optional(),
      })
      .passthrough()
      .optional(),
    request: z
      .object({
        request_id: z.union([z.string(), z.number()]).optional(),
        requestedBy_username: z.string().optional(),
      })
      .passthrough()
      .optional(),
    issue: z
      .object({
        issue_id: z.union([z.string(), z.number()]).optional(),
        issue_type: z.string().optional(),
        issue_status: z.string().optional(),
        reportedBy_username: z.string().optional(),
        reportedBy_settings_discordId: z.string().optional(),
      })
      .passthrough()
      .optional(),
    comment: z
      .object({
        comment_message: z.string().optional(),
        commentedBy_username: z.string().optional(),
        commentedBy_settings_discordId: z.string().optional(),
      })
      .passthrough()
      .optional(),
    extra: z.array(z.object({ name: z.string(), value: z.string() }).passthrough()).optional(),
  })
  .passthrough();

export type SeerrPayload = z.infer<typeof seerrPayloadSchema>;

// ─── Tautulli ───────────────────────────────────────

const tautulliEmbedField = z
  .object({
    name: z.string(),
    value: z.string(),
    inline: z.boolean().optional(),
  })
  .passthrough();

const tautulliDiscordEmbed = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    url: z.string().optional(),
    color: z.number().optional(),
    footer: z.object({ text: z.string(), icon_url: z.string().optional() }).passthrough().optional(),
    image: z.object({ url: z.string() }).passthrough().optional(),
    thumbnail: z.object({ url: z.string() }).passthrough().optional(),
    author: z
      .object({ name: z.string(), icon_url: z.string().optional(), url: z.string().optional() })
      .passthrough()
      .optional(),
    fields: z.array(tautulliEmbedField).optional(),
  })
  .passthrough();

export const tautulliDiscordPayloadSchema = z
  .object({
    content: z.string().optional(),
    username: z.string().optional(),
    avatar_url: z.string().optional(),
    embeds: z.array(tautulliDiscordEmbed).optional(),
  })
  .passthrough();

export const tautulliCustomPayloadSchema = z
  .object({
    event: z.string().optional(),
    action: z.string().optional(),
    title: z.string().optional(),
    year: z.union([z.string(), z.number()]).optional(),
    mediaType: z.string().optional(),
    summary: z.string().optional(),
    posterUrl: z.string().optional(),
    serverName: z.string().optional(),
    user: z.string().optional(),
    player: z.string().optional(),
    progress: z.string().optional(),
    duration: z.string().optional(),
    progressPercent: z.union([z.string(), z.number()]).optional(),
    episode: z.string().optional(),
    season: z.string().optional(),
    showTitle: z.string().optional(),
  })
  .passthrough();

export const tautulliPayloadSchema = z.union([
  tautulliDiscordPayloadSchema,
  tautulliCustomPayloadSchema,
]);

export type TautulliDiscordPayload = z.infer<typeof tautulliDiscordPayloadSchema>;
export type TautulliCustomPayload = z.infer<typeof tautulliCustomPayloadSchema>;
export type TautulliPayload = z.infer<typeof tautulliPayloadSchema>;

// ─── Maintainerr (Discord-shape webhook) ────────────

export const maintainerrPayloadSchema = z
  .object({
    content: z.string().optional(),
    username: z.string().optional(),
    avatar_url: z.string().optional(),
    embeds: z.array(tautulliDiscordEmbed).optional(),
  })
  .passthrough();

export type MaintainerrPayload = z.infer<typeof maintainerrPayloadSchema>;
export type MaintainerrEmbed = z.infer<typeof tautulliDiscordEmbed>;
