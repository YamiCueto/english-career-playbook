import { Injectable, inject, signal, effect, OnDestroy } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { SyncQueueService } from './sync-queue.service';
import { GlobalSyncStatus, getStorageNamespace, SyncQueueItem } from '../models/sync.model';
import {
  PracticeAttempt,
  SessionSummary,
  ProgressEvaluation,
  mapAttemptToDatabaseRow,
  mapSessionToDatabaseRow,
  mapEvaluationToDatabaseRow,
  mapDatabaseRowToAttempt,
  mapDatabaseRowToSession,
  mapDatabaseRowToEvaluation,
  PracticeAttemptRow,
  SessionRow,
  ProgressEvaluationRow,
} from '../models/session.model';

@Injectable({
  providedIn: 'root',
})
export class RemoteSyncService implements OnDestroy {
  private supabaseService = inject(SupabaseService);
  private queueService = inject(SyncQueueService);

  readonly syncStatus = signal<GlobalSyncStatus>('local');

  private activeUserId: string | null = null;
  private syncGeneration = 0;
  private listenersRegistered = false;

  private onlineHandler = () => {
    if (this.activeUserId) {
      void this.requestSync();
    }
  };

  private offlineHandler = () => {
    if (this.activeUserId) {
      const queue = this.queueService.getQueue(this.activeUserId);
      if (queue.length > 0) {
        this.syncStatus.set('pending');
      }
    }
  };

  constructor() {
    effect(() => {
      const user = this.supabaseService.currentUser();
      if (user) {
        if (this.activeUserId !== user.id) {
          void this.handleSignIn(user.id);
        }
      } else {
        if (this.activeUserId !== null) {
          this.handleSignOut();
        }
      }
    });

    if (typeof window !== 'undefined' && !this.listenersRegistered) {
      window.addEventListener('online', this.onlineHandler);
      window.addEventListener('offline', this.offlineHandler);
      this.listenersRegistered = true;
    }
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined' && this.listenersRegistered) {
      window.removeEventListener('online', this.onlineHandler);
      window.removeEventListener('offline', this.offlineHandler);
      this.listenersRegistered = false;
    }
  }

  get currentUserId(): string | null {
    return this.activeUserId;
  }

  async handleSignIn(userId: string): Promise<void> {
    const opGen = ++this.syncGeneration;
    this.activeUserId = userId;
    this.syncStatus.set('syncing');

    await this.withSyncLock(userId, async () => {
      if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
        return;
      }
      try {
        await this.pull(userId, opGen);
        if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
          return;
        }
        await this.pushPending(userId, opGen);
      } catch {
        if (this.syncGeneration === opGen && this.activeUserId === userId) {
          this.updateFinalStatus(userId);
        }
      }
    });

    if (this.syncGeneration === opGen && this.activeUserId === userId) {
      this.updateFinalStatus(userId);
    }
  }

  handleSignOut(): void {
    ++this.syncGeneration;
    this.activeUserId = null;
    this.syncStatus.set('local');
  }

  async requestSync(): Promise<void> {
    const user = this.supabaseService.currentUser();
    if (!user) {
      this.syncStatus.set('local');
      return;
    }

    if (this.activeUserId !== user.id) {
      await this.handleSignIn(user.id);
      return;
    }

    const opGen = this.syncGeneration;
    await this.withSyncLock(user.id, async () => {
      if (this.syncGeneration !== opGen || this.activeUserId !== user.id) {
        return;
      }
      this.syncStatus.set('syncing');
      try {
        await this.pushPending(user.id, opGen);
      } finally {
        if (this.syncGeneration === opGen && this.activeUserId === user.id) {
          this.updateFinalStatus(user.id);
        }
      }
    });
  }

  async pull(userId: string, opGen = this.syncGeneration): Promise<void> {
    const client = this.supabaseService.client;
    if (!client) {
      return;
    }

    if (this.activeUserId === null && this.supabaseService.currentUser()?.id === userId) {
      this.activeUserId = userId;
    }

    const pageSize = 100;

    let sessionOffset = 0;
    const remoteSessions: SessionRow[] = [];
    while (true) {
      if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
        return;
      }
      const { data, error } = await client
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(sessionOffset, sessionOffset + pageSize - 1);

      if (error) {
        throw error;
      }
      if (!data || data.length === 0) {
        break;
      }
      remoteSessions.push(...data);
      if (data.length < pageSize) {
        break;
      }
      sessionOffset += pageSize;
    }

    let evalOffset = 0;
    const remoteEvaluations: ProgressEvaluationRow[] = [];
    while (true) {
      if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
        return;
      }
      const { data, error } = await client
        .from('progress_evaluations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(evalOffset, evalOffset + pageSize - 1);

      if (error) {
        throw error;
      }
      if (!data || data.length === 0) {
        break;
      }
      remoteEvaluations.push(...data);
      if (data.length < pageSize) {
        break;
      }
      evalOffset += pageSize;
    }

    const evalMap = new Map<string, ProgressEvaluation>();
    for (const ev of remoteEvaluations) {
      evalMap.set(ev.session_id, mapDatabaseRowToEvaluation(ev));
    }

    let attemptOffset = 0;
    const remoteAttempts: PracticeAttemptRow[] = [];
    while (true) {
      if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
        return;
      }
      const { data, error } = await client
        .from('practice_attempts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(attemptOffset, attemptOffset + pageSize - 1);

      if (error) {
        throw error;
      }
      if (!data || data.length === 0) {
        break;
      }
      remoteAttempts.push(...data);
      if (data.length < pageSize) {
        break;
      }
      attemptOffset += pageSize;
    }

    if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
      return;
    }

    const namespace = getStorageNamespace(userId);

    const localSessions = this.loadLocalSessions(namespace.sessionsKey);
    const localSessionMap = new Map(localSessions.map((s) => [s.id, s]));
    const mergedSessions: SessionSummary[] = [...localSessions];

    for (const row of remoteSessions) {
      const existing = localSessionMap.get(row.id);
      if (existing) {
        if (existing.syncStatus === 'pending') {
          const isIdentical =
            row.session_date === existing.date &&
            row.focus_theme === existing.theme &&
            row.duration_minutes === existing.durationMinutes &&
            (row.notes ?? undefined) === (existing.notes ?? undefined);
          if (isIdentical) {
            existing.syncStatus = 'synced';
            this.queueService.removeItem(userId, existing.id);
          } else {
            existing.syncStatus = 'conflict';
            this.queueService.updateItem(userId, existing.id, {
              status: 'conflict',
              lastError: 'Remote record exists with different content',
            });
            this.syncStatus.set('conflict');
          }
          const idx = mergedSessions.findIndex((s) => s.id === row.id);
          if (idx >= 0) {
            mergedSessions[idx] = existing;
          }
        } else if (existing.syncStatus !== 'conflict' && existing.syncStatus !== 'error') {
          const updated = mapDatabaseRowToSession(row, evalMap.get(row.id));
          const idx = mergedSessions.findIndex((s) => s.id === row.id);
          if (idx >= 0) {
            mergedSessions[idx] = updated;
          }
        }
      } else {
        const mapped = mapDatabaseRowToSession(row, evalMap.get(row.id));
        mergedSessions.push(mapped);
        localSessionMap.set(mapped.id, mapped);
      }
    }
    localStorage.setItem(namespace.sessionsKey, JSON.stringify(mergedSessions));

    const localAttempts = this.loadLocalAttempts(namespace.attemptsKey);
    const localAttemptMap = new Map(localAttempts.map((a) => [a.id, a]));
    const mergedAttempts: PracticeAttempt[] = [...localAttempts];

    for (const row of remoteAttempts) {
      const existing = localAttemptMap.get(row.id);
      if (existing) {
        if (existing.syncStatus === 'pending') {
          const isIdentical =
            row.pattern_id === existing.patternId &&
            row.user_input === existing.userInput;
          if (isIdentical) {
            existing.syncStatus = 'synced';
            this.queueService.removeItem(userId, existing.id);
          } else {
            existing.syncStatus = 'conflict';
            this.queueService.updateItem(userId, existing.id, {
              status: 'conflict',
              lastError: 'Remote record exists with different content',
            });
            this.syncStatus.set('conflict');
          }
          const idx = mergedAttempts.findIndex((a) => a.id === row.id);
          if (idx >= 0) {
            mergedAttempts[idx] = existing;
          }
        } else if (existing.syncStatus !== 'conflict' && existing.syncStatus !== 'error') {
          const updated = mapDatabaseRowToAttempt(row);
          const idx = mergedAttempts.findIndex((a) => a.id === row.id);
          if (idx >= 0) {
            mergedAttempts[idx] = updated;
          }
        }
      } else {
        const mapped = mapDatabaseRowToAttempt(row);
        mergedAttempts.push(mapped);
        localAttemptMap.set(mapped.id, mapped);
      }
    }
    mergedAttempts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    localStorage.setItem(namespace.attemptsKey, JSON.stringify(mergedAttempts));
  }

  async pushPending(userId: string, opGen = this.syncGeneration): Promise<void> {
    const client = this.supabaseService.client;
    if (!client) {
      return;
    }

    if (this.activeUserId === null && this.supabaseService.currentUser()?.id === userId) {
      this.activeUserId = userId;
    }

    const orderedQueue = this.queueService.peekOrderedQueue(userId);
    if (orderedQueue.length === 0) {
      return;
    }

    for (const item of orderedQueue) {
      if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
        return;
      }

      if (item.entityType === 'session') {
        const sessionPayload = item.payload as SessionSummary;
        const row = mapSessionToDatabaseRow(sessionPayload, userId);
        const { error: insertError } = await client.from('sessions').insert(row);

        if (!insertError) {
          const { data: remoteRow, error: verifyError } = await client
            .from('sessions')
            .select('*')
            .eq('id', item.id)
            .maybeSingle();

          if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
            return;
          }

          if (verifyError) {
            this.handleTransientError(userId, item.id);
            break;
          } else if (remoteRow) {
            const isMatch =
              remoteRow.id === item.id &&
              remoteRow.user_id === userId &&
              remoteRow.session_date === row.session_date &&
              remoteRow.focus_theme === row.focus_theme &&
              remoteRow.duration_minutes === row.duration_minutes;

            if (isMatch) {
              const saved = this.markLocalSessionStatus(userId, item.id, 'synced');
              if (saved) {
                this.safelyRemoveFromQueue(userId, item);
              }
            } else {
              this.markLocalSessionStatus(userId, item.id, 'conflict');
              this.queueService.updateItem(userId, item.id, {
                status: 'conflict',
                lastError: 'Remote record exists with different content',
              });
              this.syncStatus.set('conflict');
            }
          }
        } else {
          if (this.isDuplicateKeyError(insertError)) {
            const { data: remoteRow, error: verifyError } = await client
              .from('sessions')
              .select('*')
              .eq('id', item.id)
              .maybeSingle();

            if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
              return;
            }

            if (verifyError) {
              this.handleTransientError(userId, item.id);
              break;
            } else if (remoteRow) {
              const isMatch =
                remoteRow.id === item.id &&
                remoteRow.user_id === userId &&
                remoteRow.session_date === row.session_date &&
                remoteRow.focus_theme === row.focus_theme &&
                remoteRow.duration_minutes === row.duration_minutes;

              if (isMatch) {
                const saved = this.markLocalSessionStatus(userId, item.id, 'synced');
                if (saved) {
                  this.safelyRemoveFromQueue(userId, item);
                }
              } else {
                this.markLocalSessionStatus(userId, item.id, 'conflict');
                this.queueService.updateItem(userId, item.id, {
                  status: 'conflict',
                  lastError: 'Remote record exists with different content',
                });
                this.syncStatus.set('conflict');
              }
            }
          } else if (this.isPermanentError(insertError)) {
            this.queueService.moveToDeadletter(userId, item.id, insertError.message);
            this.markLocalSessionStatus(userId, item.id, 'error');
            this.syncStatus.set('error');
          } else {
            this.handleTransientError(userId, item.id);
            break;
          }
        }
      } else if (item.entityType === 'progress_evaluation') {
        const evalPayload = item.payload as ProgressEvaluation & { sessionId: string };
        const row = mapEvaluationToDatabaseRow(evalPayload, evalPayload.sessionId, userId);
        const { error: insertError } = await client.from('progress_evaluations').insert(row);

        if (!insertError) {
          const { data: remoteRow, error: verifyError } = await client
            .from('progress_evaluations')
            .select('*')
            .eq('session_id', row.session_id)
            .maybeSingle();

          if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
            return;
          }

          if (verifyError) {
            this.handleTransientError(userId, item.id);
            break;
          } else if (remoteRow) {
            const isMatch =
              remoteRow.session_id === row.session_id &&
              remoteRow.user_id === userId &&
              remoteRow.comprehension_score === row.comprehension_score &&
              remoteRow.fluency_score === row.fluency_score;

            if (isMatch) {
              this.safelyRemoveFromQueue(userId, item);
            } else {
              this.queueService.updateItem(userId, item.id, {
                status: 'conflict',
                lastError: 'Remote evaluation exists with different content',
              });
              this.syncStatus.set('conflict');
            }
          }
        } else {
          if (this.isDuplicateKeyError(insertError)) {
            const { data: remoteRow, error: verifyError } = await client
              .from('progress_evaluations')
              .select('*')
              .eq('session_id', row.session_id)
              .maybeSingle();

            if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
              return;
            }

            if (verifyError) {
              this.handleTransientError(userId, item.id);
              break;
            } else if (remoteRow) {
              const isMatch =
                remoteRow.session_id === row.session_id &&
                remoteRow.user_id === userId &&
                remoteRow.comprehension_score === row.comprehension_score &&
                remoteRow.fluency_score === row.fluency_score;

              if (isMatch) {
                this.safelyRemoveFromQueue(userId, item);
              } else {
                this.queueService.updateItem(userId, item.id, {
                  status: 'conflict',
                  lastError: 'Remote evaluation exists with different content',
                });
                this.syncStatus.set('conflict');
              }
            }
          } else if (this.isPermanentError(insertError)) {
            this.queueService.moveToDeadletter(userId, item.id, insertError.message);
            this.syncStatus.set('error');
          } else {
            this.handleTransientError(userId, item.id);
            break;
          }
        }
      } else if (item.entityType === 'practice_attempt') {
        const attemptPayload = item.payload as PracticeAttempt;
        const row = mapAttemptToDatabaseRow(attemptPayload, userId);
        const { error: insertError } = await client.from('practice_attempts').insert(row);

        if (!insertError) {
          const { data: remoteRow, error: verifyError } = await client
            .from('practice_attempts')
            .select('*')
            .eq('id', item.id)
            .maybeSingle();

          if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
            return;
          }

          if (verifyError) {
            this.handleTransientError(userId, item.id);
            break;
          } else if (remoteRow) {
            const isMatch =
              remoteRow.id === item.id &&
              remoteRow.user_id === userId &&
              remoteRow.pattern_id === row.pattern_id &&
              remoteRow.user_input === row.user_input;

            if (isMatch) {
              const saved = this.markLocalAttemptStatus(userId, item.id, 'synced');
              if (saved) {
                this.safelyRemoveFromQueue(userId, item);
              }
            } else {
              this.markLocalAttemptStatus(userId, item.id, 'conflict');
              this.queueService.updateItem(userId, item.id, {
                status: 'conflict',
                lastError: 'Remote record exists with different content',
              });
              this.syncStatus.set('conflict');
            }
          }
        } else {
          if (this.isDuplicateKeyError(insertError)) {
            const { data: remoteRow, error: verifyError } = await client
              .from('practice_attempts')
              .select('*')
              .eq('id', item.id)
              .maybeSingle();

            if (this.syncGeneration !== opGen || this.activeUserId !== userId) {
              return;
            }

            if (verifyError) {
              this.handleTransientError(userId, item.id);
              break;
            } else if (remoteRow) {
              const isMatch =
                remoteRow.id === item.id &&
                remoteRow.user_id === userId &&
                remoteRow.pattern_id === row.pattern_id &&
                remoteRow.user_input === row.user_input;

              if (isMatch) {
                const saved = this.markLocalAttemptStatus(userId, item.id, 'synced');
                if (saved) {
                  this.safelyRemoveFromQueue(userId, item);
                }
              } else {
                this.markLocalAttemptStatus(userId, item.id, 'conflict');
                this.queueService.updateItem(userId, item.id, {
                  status: 'conflict',
                  lastError: 'Remote record exists with different content',
                });
                this.syncStatus.set('conflict');
              }
            }
          } else if (this.isPermanentError(insertError)) {
            this.queueService.moveToDeadletter(userId, item.id, insertError.message);
            this.markLocalAttemptStatus(userId, item.id, 'error');
            this.syncStatus.set('error');
          } else {
            this.handleTransientError(userId, item.id);
            break;
          }
        }
      }
    }
  }

  private handleTransientError(userId: string, itemId: string): void {
    const queue = this.queueService.getQueue(userId);
    const item = queue.find((q) => q.id === itemId);
    if (item) {
      this.queueService.updateItem(userId, itemId, {
        retryCount: item.retryCount + 1,
        status: 'pending',
      });
    }
    this.syncStatus.set('pending');
  }

  private safelyRemoveFromQueue(userId: string, item: SyncQueueItem): void {
    const currentQueue = this.queueService.getQueue(userId);
    const currentItem = currentQueue.find((q) => q.id === item.id);
    if (
      currentItem &&
      currentItem.enqueuedAt === item.enqueuedAt &&
      JSON.stringify(currentItem.payload) === JSON.stringify(item.payload)
    ) {
      this.queueService.removeItem(userId, item.id);
    }
  }

  private isDuplicateKeyError(err: { code?: string; message?: string }): boolean {
    if (err.code === '23505') {
      return true;
    }
    const msg = (err.message || '').toLowerCase();
    return msg.includes('duplicate key') || msg.includes('unique constraint');
  }

  private isPermanentError(err: { code?: string; message?: string }): boolean {
    const msg = (err.message || '').toLowerCase();
    return (
      err.code === '42501' ||
      err.code === '23514' ||
      err.code === '23503' ||
      err.code === '22P02' ||
      msg.includes('check constraint') ||
      msg.includes('foreign key') ||
      msg.includes('row-level security') ||
      msg.includes('permission denied') ||
      msg.includes('not-null') ||
      msg.includes('violates')
    );
  }

  private updateFinalStatus(userId: string): void {
    const queue = this.queueService.getQueue(userId);
    const deadletter = this.queueService.getDeadletter(userId);

    const hasConflict = queue.some((item) => item.status === 'conflict');
    if (hasConflict) {
      this.syncStatus.set('conflict');
      return;
    }

    const hasError = queue.some((item) => item.status === 'error') || deadletter.length > 0;
    if (hasError) {
      this.syncStatus.set('error');
      return;
    }

    const hasPending = queue.some((item) => item.status === 'pending');
    if (hasPending) {
      this.syncStatus.set('pending');
      return;
    }

    this.syncStatus.set('synced');
  }

  private async withSyncLock<T>(userId: string, task: () => Promise<T>): Promise<T | null> {
    if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks?.request) {
      try {
        return await navigator.locks.request(`ecp_sync_${userId}`, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            return null;
          }
          return await task();
        });
      } catch {
        return await task();
      }
    }
    return await task();
  }

  private loadLocalAttempts(key: string): PracticeAttempt[] {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private loadLocalSessions(key: string): SessionSummary[] {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private markLocalAttemptStatus(userId: string, attemptId: string, status: 'synced' | 'conflict' | 'error'): boolean {
    const namespace = getStorageNamespace(userId);
    try {
      const attempts = this.loadLocalAttempts(namespace.attemptsKey);
      const idx = attempts.findIndex((a) => a.id === attemptId);
      if (idx >= 0) {
        attempts[idx].syncStatus = status;
        localStorage.setItem(namespace.attemptsKey, JSON.stringify(attempts));
      }
      return true;
    } catch {
      return false;
    }
  }

  private markLocalSessionStatus(userId: string, sessionId: string, status: 'synced' | 'conflict' | 'error'): boolean {
    const namespace = getStorageNamespace(userId);
    try {
      const sessions = this.loadLocalSessions(namespace.sessionsKey);
      const idx = sessions.findIndex((s) => s.id === sessionId);
      if (idx >= 0) {
        sessions[idx].syncStatus = status;
        localStorage.setItem(namespace.sessionsKey, JSON.stringify(sessions));
      }
      return true;
    } catch {
      return false;
    }
  }
}
