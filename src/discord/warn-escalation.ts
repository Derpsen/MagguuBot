import { checkModerationTarget, type ModerationGuardInput } from './moderation-guard.js';

export type EscalationAction = 'kick' | 'timeout';

export interface EscalationStep {
  action: EscalationAction;
  threshold: number;
}

export interface EscalationConfig {
  enabled: boolean;
  timeoutAt: number;
  kickAt: number;
}

/** Which auto-escalation (if any) a warning count triggers. Kick wins over timeout. */
export function pickEscalation(count: number, config: EscalationConfig): EscalationStep | null {
  if (!config.enabled) return null;
  if (config.kickAt > 0 && count >= config.kickAt) return { action: 'kick', threshold: config.kickAt };
  if (config.timeoutAt > 0 && count >= config.timeoutAt) return { action: 'timeout', threshold: config.timeoutAt };
  return null;
}

const LABEL: Record<EscalationAction, string> = { kick: 'Auto-Kick', timeout: 'Auto-Timeout' };

/** "❌ Deine höchste Rolle …" → "Deine höchste Rolle …" so it reads as a sub-clause. */
function stripMarker(text: string): string {
  return text.replace(/^❌\s*/u, '');
}

/**
 * Runs an escalation step through the shared moderation guard (same rules as
 * /kick and /timeout). The warning itself is always recorded by the caller; a
 * denied step is skipped and the returned line explains why. `execute` is only
 * called when the guard allows the action.
 */
export async function runEscalation<R>(
  step: EscalationStep,
  count: number,
  guard: Omit<ModerationGuardInput<R>, 'action'>,
  execute: (action: EscalationAction) => Promise<void>,
  onError: (err: unknown) => void = () => {},
): Promise<string> {
  const range = `${count} ≥ ${step.threshold}`;
  const denied = checkModerationTarget({ ...guard, action: step.action });
  if (denied) return `⏭️ ${LABEL[step.action]} übersprungen (${range}): ${stripMarker(denied)}`;
  try {
    await execute(step.action);
  } catch (err) {
    onError(err);
    return `Eskalation fehlgeschlagen — fehlende Permissions (${range})`;
  }
  return step.action === 'kick' ? `Auto-kick (${range})` : `Auto-timeout 1h (${range})`;
}
