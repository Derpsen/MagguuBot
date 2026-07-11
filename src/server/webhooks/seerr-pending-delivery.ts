export type SeerrPendingDeliveryTarget = 'approval' | 'lifecycle';

export function seerrPendingDeliveryTargets(
  replayEventType: string | undefined,
  separateLifecycleChannel: boolean,
): SeerrPendingDeliveryTarget[] {
  if (replayEventType === 'MEDIA_PENDING_LIFECYCLE') return ['lifecycle'];
  if (replayEventType !== undefined) return ['approval'];
  return separateLifecycleChannel ? ['approval', 'lifecycle'] : ['approval'];
}
