export interface SnipedMessage {
  authorId: string;
  authorTag: string;
  authorAvatarUrl: string;
  content: string;
  attachments: string[];
  deletedAt: number;
}

export interface EditSnipedMessage extends SnipedMessage {
  newContent: string;
  editedAt: number;
}

const MAX_AGE_MS = 60 * 60 * 1000;
const deleted = new Map<string, SnipedMessage>();
const edited = new Map<string, EditSnipedMessage>();

export function recordDeleted(channelId: string, snap: SnipedMessage): void {
  deleted.set(channelId, snap);
}

export function recordEdited(channelId: string, snap: EditSnipedMessage): void {
  edited.set(channelId, snap);
}

export function getLastDeleted(channelId: string): SnipedMessage | undefined {
  const snap = deleted.get(channelId);
  if (!snap) return undefined;
  if (Date.now() - snap.deletedAt > MAX_AGE_MS) {
    deleted.delete(channelId);
    return undefined;
  }
  return snap;
}

export function getLastEdited(channelId: string): EditSnipedMessage | undefined {
  const snap = edited.get(channelId);
  if (!snap) return undefined;
  if (Date.now() - snap.editedAt > MAX_AGE_MS) {
    edited.delete(channelId);
    return undefined;
  }
  return snap;
}
