import { AsyncLocalStorage } from 'node:async_hooks';

export interface WebhookReplayContext {
  replayOfEventId: number;
  suppressRetrySchedule: boolean;
  source: string;
  eventType: string;
}

const storage = new AsyncLocalStorage<WebhookReplayContext>();

export function withWebhookReplayContext<T>(context: WebhookReplayContext, task: () => Promise<T>): Promise<T> {
  return storage.run(context, task);
}

export function getWebhookReplayContext(): WebhookReplayContext | undefined {
  return storage.getStore();
}
