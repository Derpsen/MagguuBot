import { CHANNEL, ROLES_PANEL_CHANNEL_NAME } from '../discord/server-layout.js';

/** Second pinned message in the welcome channel (bot help). */
export const WELCOME_HELP_PLAN_NAME = `${CHANNEL.welcome}#hilfe`;

/** Pinned message in the welcome channel that carries the single role-button set. */
export const ROLE_PICKER_PLAN_NAME = `${ROLES_PANEL_CHANNEL_NAME}#rollen`;

/** Welcome embeds that mention other channels and must refresh when refs move. */
export const REF_AWARE_WELCOME_NAMES: ReadonlySet<string> = new Set([
  CHANNEL.welcome,
  WELCOME_HELP_PLAN_NAME,
  CHANNEL.requests,
  CHANNEL.help,
]);

export interface SetupWelcomeChannel {
  planName: string;
  status: 'create' | 'rename' | 'exists';
}

export interface WelcomeEmbedPlan {
  post: string[];
  edit: string[];
  skip: string[];
}

export function planWelcomeEmbedSync(input: {
  fullSync: boolean;
  rolesChanged: boolean;
  refsChanged: boolean;
  welcomePlanNames: ReadonlySet<string>;
  channels: readonly SetupWelcomeChannel[];
  trackedPlanNames: ReadonlySet<string>;
}): WelcomeEmbedPlan {
  const post: string[] = [];
  const edit: string[] = [];
  const skip: string[] = [];

  for (const channel of input.channels) {
    if (!input.welcomePlanNames.has(channel.planName)) continue;
    const tracked = input.trackedPlanNames.has(channel.planName);
    const changed = channel.status !== 'exists';
    const needsSync = input.fullSync
      || (input.refsChanged && REF_AWARE_WELCOME_NAMES.has(channel.planName))
      || changed
      || !tracked
      || (input.rolesChanged && channel.planName === ROLE_PICKER_PLAN_NAME);
    if (!needsSync) {
      skip.push(channel.planName);
      continue;
    }
    if (tracked && channel.status === 'exists') edit.push(channel.planName);
    else post.push(channel.planName);
  }

  return { post, edit, skip };
}
