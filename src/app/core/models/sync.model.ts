export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'error';

export type MigrationStatus = 'started' | 'staged' | 'verified' | 'completed' | 'failed';

export interface MigrationManifest {
  version: number;
  status: MigrationStatus;
  timestamp: string;
  attemptsCount: number;
  sessionsCount: number;
  error?: string;
}

export type SyncEntityType = 'session' | 'progress_evaluation' | 'practice_attempt';

export interface SyncQueueItem<T = unknown> {
  id: string;
  entityType: SyncEntityType;
  action: 'insert';
  payload: T;
  enqueuedAt: string;
  retryCount: number;
  status: SyncStatus;
  lastError?: string;
}

export interface StorageNamespace {
  attemptsKey: string;
  sessionsKey: string;
  queueKey: string;
  deadletterKey: string;
}

export function getStorageNamespace(userId: string | null): StorageNamespace {
  if (!userId) {
    return {
      attemptsKey: 'ecp_guest:attempts',
      sessionsKey: 'ecp_guest:sessions',
      queueKey: 'ecp_guest:queue',
      deadletterKey: 'ecp_guest:deadletter',
    };
  }

  const prefix = `ecp_u_${userId}:`;
  return {
    attemptsKey: `${prefix}attempts`,
    sessionsKey: `${prefix}sessions`,
    queueKey: `${prefix}queue`,
    deadletterKey: `${prefix}deadletter`,
  };
}
