import { Injectable, inject } from '@angular/core';
import { PracticeAttempt, SessionSummary } from '../models/session.model';
import { SupabaseService } from './supabase.service';
import { StorageMigrationService } from './storage-migration.service';
import { SyncQueueService } from './sync-queue.service';
import { RemoteSyncService } from './remote-sync.service';
import { generateUuidV4, isValidUuidV4 } from '../utils/uuid.util';
import { getStorageNamespace, StorageNamespace } from '../models/sync.model';
import { GUEST_STORAGE_LOCK, getUserStorageLock, withStorageLock } from '../utils/storage-lock.util';

@Injectable({
  providedIn: 'root',
})
export class PracticeStorageService {
  private supabaseService = inject(SupabaseService);
  private migrationService = inject(StorageMigrationService);
  private queueService = inject(SyncQueueService);
  private remoteSync = inject(RemoteSyncService);

  readonly syncStatus = this.remoteSync.syncStatus;

  private migrationPromise: Promise<unknown> | null = null;

  constructor() {
    this.migrationPromise = this.migrationService.migrate();
  }

  private async ensureMigrated(): Promise<void> {
    if (this.migrationPromise) {
      try {
        await this.migrationPromise;
      } catch {
        this.migrationPromise = null;
      }
    }
  }

  get currentUserId(): string | null {
    return this.supabaseService.currentUser()?.id ?? null;
  }

  get activeNamespace(): StorageNamespace {
    return getStorageNamespace(this.currentUserId);
  }

  getAttempts(targetNamespace: StorageNamespace = this.activeNamespace): PracticeAttempt[] {
    try {
      const raw = localStorage.getItem(targetNamespace.attemptsKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async saveAttempt(attempt: Omit<PracticeAttempt, 'id' | 'timestamp'>): Promise<PracticeAttempt> {
    const originUserId = this.currentUserId;
    const originNamespace = getStorageNamespace(originUserId);
    const lockName = originUserId ? getUserStorageLock(originUserId) : GUEST_STORAGE_LOCK;

    await this.ensureMigrated();

    const savedAttempt = await withStorageLock(lockName, async () => {
      if (originUserId !== null && this.currentUserId !== originUserId) {
        throw new Error('Storage context changed during operation');
      }

      const newAttempt: PracticeAttempt = {
        ...attempt,
        id: generateUuidV4(),
        timestamp: new Date().toISOString(),
        syncStatus: 'pending',
      };

      const existing = this.getAttempts(originNamespace);
      const updated = [newAttempt, ...existing.filter((a) => a.id !== newAttempt.id)].slice(0, 100);
      localStorage.setItem(originNamespace.attemptsKey, JSON.stringify(updated));

      this.queueService.enqueue(originUserId, 'practice_attempt', newAttempt);

      return newAttempt;
    });

    if (originUserId) {
      void this.remoteSync.requestSync();
    }

    return savedAttempt;
  }

  getSessions(targetNamespace: StorageNamespace = this.activeNamespace): SessionSummary[] {
    try {
      const raw = localStorage.getItem(targetNamespace.sessionsKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async saveSession(session: SessionSummary): Promise<void> {
    const originUserId = this.currentUserId;
    const originNamespace = getStorageNamespace(originUserId);
    const lockName = originUserId ? getUserStorageLock(originUserId) : GUEST_STORAGE_LOCK;

    await this.ensureMigrated();

    await withStorageLock(lockName, async () => {
      if (originUserId !== null && this.currentUserId !== originUserId) {
        throw new Error('Storage context changed during operation');
      }

      const validatedId = isValidUuidV4(session.id) ? session.id : generateUuidV4();
      const newSession: SessionSummary = {
        ...session,
        id: validatedId,
        syncStatus: 'pending',
      };

      const existing = this.getSessions(originNamespace);
      const updated = [newSession, ...existing.filter((s) => s.id !== newSession.id)];
      localStorage.setItem(originNamespace.sessionsKey, JSON.stringify(updated));

      this.queueService.enqueue(originUserId, 'session', newSession);

      if (newSession.evaluation) {
        this.queueService.enqueue(originUserId, 'progress_evaluation', {
          id: generateUuidV4(),
          sessionId: newSession.id,
          ...newSession.evaluation,
        });
      }
    });

    if (originUserId) {
      void this.remoteSync.requestSync();
    }
  }

  getPendingQueueCount(): number {
    return this.queueService.getQueue(this.currentUserId).length;
  }
}
