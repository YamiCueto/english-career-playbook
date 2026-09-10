import { PracticeAttempt, SessionSummary } from './session.model';
import { SyncEntityType, SyncQueueItem } from './sync.model';

export type ClaimCheckpoint =
  | 'SNAPSHOT_CAPTURED'
  | 'LOCAL_MERGED'
  | 'ENQUEUED'
  | 'REMOTE_VERIFIED'
  | 'PARTIALLY_VERIFIED'
  | 'PURGED'
  | 'COMPLETED'
  | 'FAILED';

export type VerificationStatus =
  | 'verified'
  | 'remote_conflict'
  | 'not_found'
  | 'unauthorized'
  | 'error';

export interface ClaimVerificationReceipt {
  receiptId: string;
  claimId: string;
  userId: string;
  entityType: SyncEntityType;
  entityId: string;
  expectedFingerprint: string;
  remoteRowId?: string;
  remoteUserId?: string;
  remoteFingerprint?: string;
  verifiedAt: string;
  status: VerificationStatus;
  errorMessage?: string;
}

export type EntityClaimStatus =
  | 'staged'
  | 'merged'
  | 'synced'
  | 'local_conflict'
  | 'remote_conflict'
  | 'invalid_orphan'
  | 'error';

export interface EntityClaimRecord {
  id: string;
  entityType: SyncEntityType;
  status: EntityClaimStatus;
  fingerprint: string;
  error?: string;
  verifiedAt?: string;
}

export interface DurableClaimSnapshot {
  sessions: SessionSummary[];
  attempts: PracticeAttempt[];
  queueItems: SyncQueueItem[];
}

export interface GuestClaimManifest {
  claimId: string;
  userId: string;
  checkpoint: ClaimCheckpoint;
  createdAt: string;
  updatedAt: string;
  sourceFingerprint: string;
  snapshot: DurableClaimSnapshot;
  receipts: Record<string, ClaimVerificationReceipt>;
  error?: string;
}

export interface UserClaimDecision {
  userId: string;
  decision: 'separate' | 'postponed';
  guestFingerprint: string;
  decidedAt: string;
}

export interface GuestClaimSummary {
  sessionsCount: number;
  attemptsCount: number;
  evaluationsCount: number;
  fingerprint: string;
  hasOrphans: boolean;
  orphanCount: number;
}
