import { createHash } from 'node:crypto';

export function hashSlashCommandBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}
