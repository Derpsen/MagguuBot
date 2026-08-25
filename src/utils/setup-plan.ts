export const REF_AWARE_WELCOME_NAMES = new Set([
  '👋・willkommen',
  '🤖・bot-hilfe',
  '📝・anfragen',
  '📥・grabs',
  '❓・faq',
]);

export const ROLE_PICKER_PLAN_NAME = '🎭・rollen';

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
