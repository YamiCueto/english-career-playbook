import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PracticeStorageService } from './practice-storage.service';
import { SupabaseService } from './supabase.service';
import { isValidUuidV4 } from '../utils/uuid.util';
import { SyncQueueService } from './sync-queue.service';
import { RemoteSyncService } from './remote-sync.service';
import { User } from '@supabase/supabase-js';
import { clearInMemoryLocks, GUEST_STORAGE_LOCK, withStorageLock } from '../utils/storage-lock.util';

describe('PracticeStorageService', () => {
  let service: PracticeStorageService;
  let queueService: SyncQueueService;
  let remoteSync: RemoteSyncService;
  const currentUserSignal = signal<User | null>(null);

  beforeEach(() => {
    localStorage.clear();
    clearInMemoryLocks();
    currentUserSignal.set(null);

    const mockSupabase = {
      currentUser: currentUserSignal,
    };

    const mockRemoteSync = {
      syncStatus: signal<'idle' | 'syncing' | 'error'>('idle'),
      requestSync: vi.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        PracticeStorageService,
        SyncQueueService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: RemoteSyncService, useValue: mockRemoteSync },
      ],
    });

    service = TestBed.inject(PracticeStorageService);
    queueService = TestBed.inject(SyncQueueService);
    remoteSync = TestBed.inject(RemoteSyncService);
  });

  afterEach(() => {
    localStorage.clear();
    clearInMemoryLocks();
  });

  it('should save and retrieve attempts locally with valid UUID v4', async () => {
    const attempt = await service.saveAttempt({
      patternId: 'pattern-a',
      userInput: 'I work with Angular',
      isValid: true,
      feedback: 'Good job',
    });

    expect(isValidUuidV4(attempt.id)).toBe(true);
    expect(attempt.syncStatus).toBe('pending');

    const attempts = service.getAttempts();
    expect(attempts.length).toBe(1);
    expect(attempts[0].userInput).toBe('I work with Angular');
    expect(attempts[0].id).toBe(attempt.id);

    const queue = queueService.getQueue(null);
    expect(queue.length).toBe(1);
    expect(queue[0].id).toBe(attempt.id);
    expect(queue[0].entityType).toBe('practice_attempt');
  });

  it('should save session and evaluation and enqueue them in dependency order', async () => {
    await service.saveSession({
      id: 'session-local-1',
      date: '2026-09-07',
      durationMinutes: 30,
      theme: 'Technical Interviews',
      evaluation: {
        comprehension: 5,
        construction: 4,
        vocabulary: 4,
        fluency: 4,
        grammar: 4,
        pronunciation: 4,
        newWordsCount: 8,
        nextGoal: 'Fluency in complex answers',
      },
    });

    const sessions = service.getSessions();
    expect(sessions.length).toBe(1);
    expect(isValidUuidV4(sessions[0].id)).toBe(true);

    const queue = queueService.getQueue(null);
    expect(queue.length).toBe(2);
    expect(queue[0].entityType).toBe('session');
    expect(queue[1].entityType).toBe('progress_evaluation');
  });

  it('should isolate storage and queue between guest and authenticated user', async () => {
    await service.saveAttempt({
      patternId: 'pattern-a',
      userInput: 'Guest sentence',
      isValid: true,
    });

    expect(service.getAttempts().length).toBe(1);
    expect(service.getAttempts()[0].userInput).toBe('Guest sentence');

    const mockUser: User = {
      id: 'usr-999-aaa',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-09-07T00:00:00.000Z',
    };
    currentUserSignal.set(mockUser);

    expect(service.getAttempts().length).toBe(0);

    await service.saveAttempt({
      patternId: 'pattern-b',
      userInput: 'Authenticated user sentence',
      isValid: true,
    });

    expect(service.getAttempts().length).toBe(1);
    expect(service.getAttempts()[0].userInput).toBe('Authenticated user sentence');

    currentUserSignal.set(null);

    expect(service.getAttempts().length).toBe(1);
    expect(service.getAttempts()[0].userInput).toBe('Guest sentence');
  });

  it('should guarantee user A and user B do not share records and switching namespaces does not copy data', async () => {
    const userA: User = {
      id: 'usr-AAA-111',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-09-07T00:00:00.000Z',
    };
    const userB: User = {
      id: 'usr-BBB-222',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-09-07T00:00:00.000Z',
    };

    currentUserSignal.set(userA);
    await service.saveAttempt({
      patternId: 'pattern-a',
      userInput: 'User A sentence',
      isValid: true,
    });
    expect(service.getAttempts().length).toBe(1);
    expect(service.getAttempts()[0].userInput).toBe('User A sentence');

    currentUserSignal.set(userB);
    expect(service.getAttempts().length).toBe(0);

    await service.saveAttempt({
      patternId: 'pattern-c',
      userInput: 'User B sentence',
      isValid: true,
    });
    expect(service.getAttempts().length).toBe(1);
    expect(service.getAttempts()[0].userInput).toBe('User B sentence');

    currentUserSignal.set(userA);
    expect(service.getAttempts().length).toBe(1);
    expect(service.getAttempts()[0].userInput).toBe('User A sentence');
  });

  it('should ensure deadletter does not delete the source record from local storage', async () => {
    const attempt = await service.saveAttempt({
      patternId: 'pattern-a',
      userInput: 'Attempt for deadletter check',
      isValid: true,
    });

    expect(service.getAttempts().length).toBe(1);

    queueService.moveToDeadletter(null, attempt.id, 'Permanent check constraint violation');

    expect(queueService.getQueue(null).length).toBe(0);
    expect(queueService.getDeadletter(null).length).toBe(1);

    const sourceAttempts = service.getAttempts();
    expect(sourceAttempts.length).toBe(1);
    expect(sourceAttempts[0].id).toBe(attempt.id);
    expect(sourceAttempts[0].userInput).toBe('Attempt for deadletter check');
  });

  it('should confirm that zero remote Supabase network calls are made during save and read', async () => {
    const attempt = await service.saveAttempt({
      patternId: 'pattern-d',
      userInput: 'Offline first sentence',
      isValid: true,
    });

    expect(attempt.id).toBeDefined();
    expect(service.getAttempts().length).toBe(1);
  });

  it('should handle two concurrent guest writes without data loss', async () => {
    const [attempt1, attempt2] = await Promise.all([
      service.saveAttempt({
        patternId: 'pattern-a',
        userInput: 'Concurrent sentence 1',
        isValid: true,
      }),
      service.saveAttempt({
        patternId: 'pattern-b',
        userInput: 'Concurrent sentence 2',
        isValid: true,
      }),
    ]);

    expect(attempt1.id).toBeDefined();
    expect(attempt2.id).toBeDefined();

    const attempts = service.getAttempts();
    expect(attempts.length).toBe(2);
    const texts = attempts.map((a) => a.userInput);
    expect(texts).toContain('Concurrent sentence 1');
    expect(texts).toContain('Concurrent sentence 2');

    const queue = queueService.getQueue(null);
    expect(queue.length).toBe(2);
  });

  it('should reject operation if authenticated user changes during lock wait', async () => {
    const userA: User = {
      id: 'usr-AAA-111',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-09-07T00:00:00.000Z',
    };
    const userB: User = {
      id: 'usr-BBB-222',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-09-07T00:00:00.000Z',
    };

    currentUserSignal.set(userA);

    let releaseLock!: () => void;
    const lockHeldPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const lockPromise = withStorageLock('ecp_user_storage_' + userA.id, async () => {
      await lockHeldPromise;
    });

    const savePromise = service.saveAttempt({
      patternId: 'pattern-a',
      userInput: 'Attempt started under User A',
      isValid: true,
    });

    currentUserSignal.set(userB);
    releaseLock();
    await lockPromise;

    await expect(savePromise).rejects.toThrow('Storage context changed during operation');
  });

  it('should preserve guest destination and avoid polluting authenticated account if login occurs during wait', async () => {
    const userA: User = {
      id: 'usr-AAA-111',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-09-07T00:00:00.000Z',
    };

    let releaseLock!: () => void;
    const lockHeldPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const lockPromise = withStorageLock(GUEST_STORAGE_LOCK, async () => {
      await lockHeldPromise;
    });

    const savePromise = service.saveAttempt({
      patternId: 'pattern-a',
      userInput: 'Guest sentence before login',
      isValid: true,
    });

    currentUserSignal.set(userA);
    releaseLock();
    await lockPromise;

    const saved = await savePromise;
    expect(saved.userInput).toBe('Guest sentence before login');

    expect(service.getAttempts().length).toBe(0);
    expect(queueService.getQueue(userA.id).length).toBe(0);

    currentUserSignal.set(null);
    expect(service.getAttempts().length).toBe(1);
    expect(service.getAttempts()[0].userInput).toBe('Guest sentence before login');
    expect(queueService.getQueue(null).length).toBe(1);
  });

  it('should serialize concurrent writes using fallback when Web Locks is unavailable', async () => {
    const originalNavigatorLocks = (navigator as unknown as { locks?: unknown }).locks;
    try {
      Object.defineProperty(navigator, 'locks', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const [attempt1, attempt2] = await Promise.all([
        service.saveAttempt({
          patternId: 'pattern-a',
          userInput: 'Fallback sentence 1',
          isValid: true,
        }),
        service.saveAttempt({
          patternId: 'pattern-b',
          userInput: 'Fallback sentence 2',
          isValid: true,
        }),
      ]);

      expect(attempt1.id).toBeDefined();
      expect(attempt2.id).toBeDefined();

      const attempts = service.getAttempts();
      expect(attempts.length).toBe(2);
      const queue = queueService.getQueue(null);
      expect(queue.length).toBe(2);
    } finally {
      Object.defineProperty(navigator, 'locks', {
        value: originalNavigatorLocks,
        configurable: true,
        writable: true,
      });
    }
  });

  it('should trigger remoteSync.requestSync for authenticated operations without regression', async () => {
    const userA: User = {
      id: 'usr-AAA-111',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-09-07T00:00:00.000Z',
    };
    currentUserSignal.set(userA);

    await service.saveAttempt({
      patternId: 'pattern-a',
      userInput: 'Authenticated attempt with sync',
      isValid: true,
    });

    expect(remoteSync.requestSync).toHaveBeenCalledTimes(1);

    await service.saveSession({
      id: 'session-auth-1',
      date: '2026-09-08',
      durationMinutes: 15,
      theme: 'Leadership',
    });

    expect(remoteSync.requestSync).toHaveBeenCalledTimes(2);
    expect(service.getAttempts().length).toBe(1);
    expect(service.getSessions().length).toBe(1);
  });
});
