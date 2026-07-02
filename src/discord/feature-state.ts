import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { featureState } from '../db/schema.js';

export function getFeatureState(key: string): string | undefined {
  return db
    .select({ value: featureState.value })
    .from(featureState)
    .where(and(eq(featureState.guildId, config.DISCORD_GUILD_ID), eq(featureState.key, key)))
    .get()?.value;
}

export function setFeatureState(key: string, value: string): void {
  db.insert(featureState)
    .values({ guildId: config.DISCORD_GUILD_ID, key, value })
    .onConflictDoUpdate({
      target: [featureState.guildId, featureState.key],
      set: { value, updatedAt: new Date() },
    })
    .run();
}

export function deleteFeatureState(key: string): void {
  db.delete(featureState)
    .where(and(eq(featureState.guildId, config.DISCORD_GUILD_ID), eq(featureState.key, key)))
    .run();
}
