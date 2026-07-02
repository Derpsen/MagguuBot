import { config } from '../config.js';
import { createDatabaseSnapshot, pruneDatabaseSnapshots } from '../db/backup.js';
import { logger } from '../utils/logger.js';
import { localScheduleParts } from '../utils/schedule.js';
import { getFeatureState, setFeatureState } from './feature-state.js';

const STATE_KEY = 'automaticBackup:lastDate';

export async function runAutomaticBackupTick(now = new Date()): Promise<void> {
  if (!config.AUTOMATIC_BACKUP_ENABLED) return;
  const local = localScheduleParts(now, config.TIME_ZONE);
  if (local.hour < config.AUTOMATIC_BACKUP_HOUR || getFeatureState(STATE_KEY) === local.dateKey) return;
  const snapshot = await createDatabaseSnapshot('automatic');
  setFeatureState(STATE_KEY, local.dateKey);
  let removed = 0;
  try {
    removed = await pruneDatabaseSnapshots('automatic', config.AUTOMATIC_BACKUP_RETENTION);
  } catch (err) {
    logger.warn({ err, path: snapshot.path }, 'automatic backup retention cleanup failed');
  }
  logger.info(
    { path: snapshot.path, bytes: snapshot.size, removed, retention: config.AUTOMATIC_BACKUP_RETENTION },
    'automatic database backup completed',
  );
}
