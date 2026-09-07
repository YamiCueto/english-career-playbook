import { Injectable, inject } from '@angular/core';
import { PracticeAttempt, SessionSummary } from '../models/session.model';
import { SupabaseService } from './supabase.service';
import { StorageMigrationService } from './storage-migration.service';
import { SyncQueueService } from './sync-queue.service';
import { generateUuidV4, isValidUuidV4 } from '../utils/uuid.util';
import { getStorageNamespace, StorageNamespace } from '../models/sync.model';

@Injectable({
  providedIn: 'root',
})
export class PracticeStorageService {
  private supabaseService = inject(SupabaseService);
  private migrationService = inject(StorageMigrationService);
  private queueService = inject(SyncQueueService);

  constructor() {
    this.migrationService.migrate();
  }

  get currentUserId(): string | null {
    return this.supabaseService.currentUser()?.id ?? null;
  }

  get activeNamespace(): StorageNamespace {
    return getStorageNamespace(this.currentUserId);
  }

  getAttempts(): PracticeAttempt[] {
    try {
      const raw = localStorage.getItem(this.activeNamespace.attemptsKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  saveAttempt(attempt: Omit<PracticeAttempt, 'id' | 'timestamp'>): PracticeAttempt {
    const newAttempt: PracticeAttempt = {
      ...attempt,
      id: generateUuidV4(),
      timestamp: new Date().toISOString(),
      syncStatus: 'pending',
    };

    const existing = this.getAttempts();
    const updated = [newAttempt, ...existing.filter((a) => a.id !== newAttempt.id)].slice(0, 100);
    localStorage.setItem(this.activeNamespace.attemptsKey, JSON.stringify(updated));

    this.queueService.enqueue(this.currentUserId, 'practice_attempt', newAttempt);

    return newAttempt;
  }

  getSessions(): SessionSummary[] {
    try {
      const raw = localStorage.getItem(this.activeNamespace.sessionsKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  saveSession(session: SessionSummary): void {
    const validatedId = isValidUuidV4(session.id) ? session.id : generateUuidV4();
    const newSession: SessionSummary = {
      ...session,
      id: validatedId,
      syncStatus: 'pending',
    };

    const existing = this.getSessions();
    const updated = [newSession, ...existing.filter((s) => s.id !== newSession.id)];
    localStorage.setItem(this.activeNamespace.sessionsKey, JSON.stringify(updated));

    this.queueService.enqueue(this.currentUserId, 'session', newSession);

    if (newSession.evaluation) {
      this.queueService.enqueue(this.currentUserId, 'progress_evaluation', {
        id: generateUuidV4(),
        sessionId: newSession.id,
        ...newSession.evaluation,
      });
    }
  }

  getPendingQueueCount(): number {
    return this.queueService.getQueue(this.currentUserId).length;
  }
}
