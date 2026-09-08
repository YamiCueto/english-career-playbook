import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GuestClaimService, GUEST_CLAIM_DECISION_KEY_PREFIX, GUEST_CLAIM_POSTPONED_KEY_PREFIX, GUEST_CLAIM_MANIFEST_KEY_PREFIX } from './guest-claim.service';
import { PracticeStorageService } from './practice-storage.service';
import { SupabaseService } from './supabase.service';
import { SyncQueueService } from './sync-queue.service';
import { RemoteSyncService } from './remote-sync.service';
import {
  SessionSummary,
  PracticeAttempt,
  ProgressEvaluation,
  mapSessionToDatabaseRow,
  mapEvaluationToDatabaseRow,
  mapAttemptToDatabaseRow,
} from '../models/session.model';
import { getStorageNamespace } from '../models/sync.model';
import { signal } from '@angular/core';
import { User } from '@supabase/supabase-js';
import { makeReceiptKey } from '../utils/claim-canonical.util';
import { GUEST_STORAGE_LOCK, withStorageLock, clearInMemoryLocks } from '../utils/storage-lock.util';
import { GuestClaimManifest } from '../models/guest-claim.model';

describe('GuestClaimService', () => {
  let service: GuestClaimService;
  let mockSupabase: any;
  let mockRemoteSync: any;
  let queueService: SyncQueueService;

  const userA: User = {
    id: 'user-a-1111',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };

  const userB: User = {
    id: 'user-b-2222',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };

  const currentUserSignal = signal<User | null>(null);
  const isInitializedSignal = signal<boolean>(true);

  const sampleEval: ProgressEvaluation = {
    comprehension: 5,
    construction: 4,
    vocabulary: 4,
    fluency: 5,
    grammar: 4,
    pronunciation: 4,
    newWordsCount: 3,
    nextGoal: 'Executive summaries',
  };

  const sampleSession: SessionSummary = {
    id: 'session-1',
    date: '2026-09-07',
    durationMinutes: 40,
    theme: 'Strategy',
    notes: 'Q3 goals',
    evaluation: sampleEval,
  };

  const sampleAttempt: PracticeAttempt = {
    id: 'attempt-1',
    patternId: 'pattern-a',
    userInput: 'We need to align stakeholders.',
    isValid: true,
    feedback: 'valid',
    sessionId: 'session-1',
    timestamp: '2026-09-07T12:00:00Z',
  };

  let mockDbTables: {
    sessions: any[];
    progress_evaluations: any[];
    practice_attempts: any[];
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearInMemoryLocks();

    currentUserSignal.set(null);
    isInitializedSignal.set(true);

    mockDbTables = {
      sessions: [],
      progress_evaluations: [],
      practice_attempts: [],
    };

    const createQueryBuilder = (tableName: 'sessions' | 'progress_evaluations' | 'practice_attempts') => {
      let filterId: string | null = null;
      let filterSessionId: string | null = null;

      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation((col: string, val: string) => {
          if (col === 'id') filterId = val;
          if (col === 'session_id') filterSessionId = val;
          return builder;
        }),
        maybeSingle: vi.fn().mockImplementation(async () => {
          const rows = mockDbTables[tableName] || [];
          let match = null;
          if (filterId) {
            match = rows.find((r) => r.id === filterId);
          } else if (filterSessionId) {
            match = rows.find((r) => r.session_id === filterSessionId);
          }
          return { data: match ? { ...match } : null, error: null };
        }),
      };
      return builder;
    };

    mockSupabase = {
      currentUser: currentUserSignal,
      isInitialized: isInitializedSignal,
      client: {
        from: vi.fn().mockImplementation((table: 'sessions' | 'progress_evaluations' | 'practice_attempts') => createQueryBuilder(table)),
      },
    };

    mockRemoteSync = {
      requestSync: vi.fn().mockImplementation(async () => {
        const uid = currentUserSignal()?.id || 'unknown';
        const queue = queueService.getQueue(uid);
        for (const item of queue) {
          if (item.entityType === 'session') {
            const s = item.payload as SessionSummary;
            mockDbTables.sessions.push(mapSessionToDatabaseRow(s, uid));
          } else if (item.entityType === 'progress_evaluation') {
            const e = item.payload as ProgressEvaluation & { sessionId: string };
            mockDbTables.progress_evaluations.push(mapEvaluationToDatabaseRow(e, e.sessionId, uid));
          } else if (item.entityType === 'practice_attempt') {
            const a = item.payload as PracticeAttempt;
            mockDbTables.practice_attempts.push(mapAttemptToDatabaseRow(a, uid));
          }
        }
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        GuestClaimService,
        PracticeStorageService,
        SyncQueueService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: RemoteSyncService, useValue: mockRemoteSync },
      ],
    });

    service = TestBed.inject(GuestClaimService);
    queueService = TestBed.inject(SyncQueueService);
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearInMemoryLocks();
  });

  it('detects no guest data on clean install', () => {
    const summary = service.getGuestSummary();
    expect(summary.sessionsCount).toBe(0);
    expect(summary.attemptsCount).toBe(0);
    expect(summary.evaluationsCount).toBe(0);
    expect(summary.hasOrphans).toBe(false);
  });

  it('detects guest data and counts evaluations correctly', () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([sampleAttempt]));

    const summary = service.getGuestSummary();
    expect(summary.sessionsCount).toBe(1);
    expect(summary.attemptsCount).toBe(1);
    expect(summary.evaluationsCount).toBe(1);
    expect(summary.hasOrphans).toBe(false);
  });

  it('identifies orphan practice attempts', () => {
    const orphanAttempt: PracticeAttempt = {
      ...sampleAttempt,
      id: 'orphan-1',
      sessionId: 'unknown-session-id',
    };
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([sampleAttempt, orphanAttempt]));

    const summary = service.getGuestSummary();
    expect(summary.hasOrphans).toBe(true);
    expect(summary.orphanCount).toBe(1);
  });

  it('handles postpone per user and session without affecting another user', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    expect(service.isClaimPromptVisible()).toBe(true);

    service.postpone();
    expect(service.isClaimPromptVisible()).toBe(false);

    await service.handleUserAuthenticated(userA.id);
    expect(service.isClaimPromptVisible()).toBe(false);

    currentUserSignal.set(userB);
    await service.handleUserAuthenticated(userB.id);
    expect(service.isClaimPromptVisible()).toBe(true);
  });

  it('re-shows prompt after postpone if new guest data is created', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);
    service.postpone();

    const newAttempt: PracticeAttempt = {
      ...sampleAttempt,
      id: 'attempt-new',
      userInput: 'Additional practice in guest mode',
    };
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([newAttempt]));

    await service.handleUserAuthenticated(userA.id);
    expect(service.isClaimPromptVisible()).toBe(true);
  });

  it('handles keep separate per user without affecting another user', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);
    expect(service.isClaimPromptVisible()).toBe(true);

    service.keepSeparate();
    expect(service.isClaimPromptVisible()).toBe(false);

    await service.handleUserAuthenticated(userA.id);
    expect(service.isClaimPromptVisible()).toBe(false);

    currentUserSignal.set(userB);
    await service.handleUserAuthenticated(userB.id);
    expect(service.isClaimPromptVisible()).toBe(true);
  });

  it('executes full claim pipeline successfully with durable snapshot and receipts', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([sampleAttempt]));
    queueService.enqueue(null, 'session', sampleSession);
    queueService.enqueue(null, 'practice_attempt', sampleAttempt);

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const success = await service.claim();
    expect(success).toBe(true);
    expect(service.activeCheckpoint()).toBe('COMPLETED');

    const manifestKey = `${GUEST_CLAIM_MANIFEST_KEY_PREFIX}${userA.id}`;
    const rawManifest = localStorage.getItem(manifestKey);
    expect(rawManifest).toBeTruthy();
    const manifest = JSON.parse(rawManifest!);

    expect(manifest.checkpoint).toBe('COMPLETED');
    expect(manifest.snapshot.sessions.length).toBe(1);
    expect(manifest.snapshot.attempts.length).toBe(1);

    const sessionReceiptKey = makeReceiptKey('session', sampleSession.id);
    const evalReceiptKey = makeReceiptKey('progress_evaluation', sampleSession.id);
    const attemptReceiptKey = makeReceiptKey('practice_attempt', sampleAttempt.id);

    expect(manifest.receipts[sessionReceiptKey]?.status).toBe('verified');
    expect(manifest.receipts[evalReceiptKey]?.status).toBe('verified');
    expect(manifest.receipts[attemptReceiptKey]?.status).toBe('verified');

    const guestSessions = JSON.parse(localStorage.getItem('ecp_guest:sessions') || '[]');
    const guestAttempts = JSON.parse(localStorage.getItem('ecp_guest:attempts') || '[]');
    expect(guestSessions.length).toBe(0);
    expect(guestAttempts.length).toBe(0);

    const userNamespace = getStorageNamespace(userA.id);
    const userSessions = JSON.parse(localStorage.getItem(userNamespace.sessionsKey) || '[]');
    const userAttempts = JSON.parse(localStorage.getItem(userNamespace.attemptsKey) || '[]');
    expect(userSessions.length).toBe(1);
    expect(userAttempts.length).toBe(1);
  });

  it('deduplicates without duplicating if identical content already exists locally', async () => {
    const userNamespace = getStorageNamespace(userA.id);
    localStorage.setItem(userNamespace.sessionsKey, JSON.stringify([sampleSession]));

    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const success = await service.claim();
    expect(success).toBe(true);

    const userSessions = JSON.parse(localStorage.getItem(userNamespace.sessionsKey) || '[]');
    expect(userSessions.length).toBe(1);
  });

  it('detects local conflict and does not overwrite user destination data nor purge guest', async () => {
    const userNamespace = getStorageNamespace(userA.id);
    const conflictingUserSession: SessionSummary = {
      ...sampleSession,
      theme: 'Conflicting remote user theme',
      notes: 'Different content',
    };
    localStorage.setItem(userNamespace.sessionsKey, JSON.stringify([conflictingUserSession]));
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const success = await service.claim();
    expect(success).toBe(false);
    expect(service.activeCheckpoint()).toBe('PARTIALLY_VERIFIED');

    const userSessions = JSON.parse(localStorage.getItem(userNamespace.sessionsKey) || '[]');
    expect(userSessions[0].theme).toBe('Conflicting remote user theme');

    const guestSessions = JSON.parse(localStorage.getItem('ecp_guest:sessions') || '[]');
    expect(guestSessions.length).toBe(1);
    expect(guestSessions[0].theme).toBe('Strategy');
  });

  it('does not normalize orphan relations to null and does not send them', async () => {
    const orphanAttempt: PracticeAttempt = {
      ...sampleAttempt,
      id: 'orphan-attempt',
      sessionId: 'non-existent-session-id',
    };
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([orphanAttempt]));

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const success = await service.claim();
    expect(success).toBe(false);

    const userNamespace = getStorageNamespace(userA.id);
    const userAttempts = JSON.parse(localStorage.getItem(userNamespace.attemptsKey) || '[]');
    expect(userAttempts.length).toBe(0);

    const guestAttempts = JSON.parse(localStorage.getItem('ecp_guest:attempts') || '[]');
    expect(guestAttempts.length).toBe(1);
    expect(guestAttempts[0].sessionId).toBe('non-existent-session-id');
  });

  it('does not purge guest attempt if content was modified post-snapshot', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([sampleAttempt]));

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const origVerify = (service as any).verifyRemoteReceipts.bind(service);
    vi.spyOn(service as any, 'verifyRemoteReceipts').mockImplementation(async (...args: any[]) => {
      const modifiedAttempt: PracticeAttempt = {
        ...sampleAttempt,
        userInput: 'Modified in another tab before purge',
      };
      localStorage.setItem('ecp_guest:attempts', JSON.stringify([modifiedAttempt]));
      return origVerify(...args);
    });

    await service.claim();

    const guestAttempts = JSON.parse(localStorage.getItem('ecp_guest:attempts') || '[]');
    expect(guestAttempts.length).toBe(1);
    expect(guestAttempts[0].userInput).toBe('Modified in another tab before purge');
  });

  it('does not purge guest session if its dependent attempt remains unverified', async () => {
    const conflictingAttempt: PracticeAttempt = {
      ...sampleAttempt,
      id: 'attempt-conflict',
    };
    const userNamespace = getStorageNamespace(userA.id);
    localStorage.setItem(
      userNamespace.attemptsKey,
      JSON.stringify([{ ...conflictingAttempt, userInput: 'Different user input' }])
    );

    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([conflictingAttempt]));

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const success = await service.claim();
    expect(success).toBe(false);

    const guestSessions = JSON.parse(localStorage.getItem('ecp_guest:sessions') || '[]');
    expect(guestSessions.length).toBe(1);
  });

  it('reconciles crash after REMOTE_VERIFIED without retransmitting', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    currentUserSignal.set(userA);

    mockDbTables.sessions.push({
      id: sampleSession.id,
      user_id: userA.id,
      session_date: sampleSession.date,
      focus_theme: sampleSession.theme,
      duration_minutes: sampleSession.durationMinutes,
      notes: sampleSession.notes,
    });
    mockDbTables.progress_evaluations.push({
      session_id: sampleSession.id,
      user_id: userA.id,
      comprehension_score: sampleEval.comprehension,
      fluency_score: sampleEval.fluency,
    });

    const manifestKey = `${GUEST_CLAIM_MANIFEST_KEY_PREFIX}${userA.id}`;
    const manifest = {
      claimId: 'claim-123',
      userId: userA.id,
      checkpoint: 'REMOTE_VERIFIED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceFingerprint: 'dummy-fp',
      snapshot: {
        sessions: [sampleSession],
        attempts: [],
        queueItems: [],
      },
      receipts: {
        [makeReceiptKey('session', sampleSession.id)]: {
          receiptId: 'rec-1',
          claimId: 'claim-123',
          userId: userA.id,
          entityType: 'session',
          entityId: sampleSession.id,
          expectedFingerprint: 'fp',
          verifiedAt: new Date().toISOString(),
          status: 'verified',
        },
        [makeReceiptKey('progress_evaluation', sampleSession.id)]: {
          receiptId: 'rec-2',
          claimId: 'claim-123',
          userId: userA.id,
          entityType: 'progress_evaluation',
          entityId: sampleSession.id,
          expectedFingerprint: 'fp2',
          verifiedAt: new Date().toISOString(),
          status: 'verified',
        },
      },
    };
    localStorage.setItem(manifestKey, JSON.stringify(manifest));

    await service.handleUserAuthenticated(userA.id);

    expect(mockRemoteSync.requestSync).not.toHaveBeenCalled();
    const guestSessions = JSON.parse(localStorage.getItem('ecp_guest:sessions') || '[]');
    expect(guestSessions.length).toBe(0);

    const updatedManifest = JSON.parse(localStorage.getItem(manifestKey)!);
    expect(updatedManifest.checkpoint).toBe('COMPLETED');
  });

  it('aborts cleanly on logout and does not write under another account', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    vi.spyOn(service as any, 'verifyRemoteReceipts').mockImplementation(async () => {
      service.handleUserSignedOut();
      currentUserSignal.set(userB);
      return true;
    });

    const success = await service.claim();
    expect(success).toBe(false);

    const userBNamespace = getStorageNamespace(userB.id);
    const userBSessions = JSON.parse(localStorage.getItem(userBNamespace.sessionsKey) || '[]');
    expect(userBSessions.length).toBe(0);
  });

  it('handles malformed JSON in guest storage without throwing', () => {
    localStorage.setItem('ecp_guest:sessions', '{ bad json');
    localStorage.setItem('ecp_guest:attempts', '[ not json');
    const summary = service.getGuestSummary();
    expect(summary.sessionsCount).toBe(0);
    expect(summary.attemptsCount).toBe(0);
  });

  it('handles storage quota exceeded error gracefully', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    const success = await service.claim();
    spy.mockRestore();

    expect(success).toBe(false);
    expect(service.claimError()).toBeTruthy();
  });

  it('preserves newly created guest records added after manifest snapshot', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([sampleAttempt]));

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const origVerify = (service as any).verifyRemoteReceipts.bind(service);
    vi.spyOn(service as any, 'verifyRemoteReceipts').mockImplementation(async (...args: any[]) => {
      const concurrentSession: SessionSummary = {
        id: 'session-concurrent-new',
        date: '2026-09-08',
        durationMinutes: 30,
        theme: 'Concurrent guest work',
      };
      const existing = JSON.parse(localStorage.getItem('ecp_guest:sessions') || '[]');
      localStorage.setItem('ecp_guest:sessions', JSON.stringify([...existing, concurrentSession]));
      return origVerify(...args);
    });

    const success = await service.claim();
    expect(success).toBe(true);

    const guestSessions = JSON.parse(localStorage.getItem('ecp_guest:sessions') || '[]');
    expect(guestSessions.length).toBe(1);
    expect(guestSessions[0].id).toBe('session-concurrent-new');
  });

  it('retries successfully after partial verification', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    let failRemoteOnce = true;
    const origVerify = (service as any).verifyRemoteReceipts.bind(service);
    vi.spyOn(service as any, 'verifyRemoteReceipts').mockImplementation(async (...args: any[]) => {
      if (failRemoteOnce) {
        failRemoteOnce = false;
        return false;
      }
      return origVerify(...args);
    });

    const firstAttemptSuccess = await service.claim();
    expect(firstAttemptSuccess).toBe(false);
    expect(service.activeCheckpoint()).toBe('PARTIALLY_VERIFIED');

    const guestSessionsAfterFirst = JSON.parse(localStorage.getItem('ecp_guest:sessions') || '[]');
    expect(guestSessionsAfterFirst.length).toBe(1);

    const retrySuccess = await service.claim();
    expect(retrySuccess).toBe(true);
    expect(service.activeCheckpoint()).toBe('COMPLETED');

    const guestSessionsAfterRetry = JSON.parse(localStorage.getItem('ecp_guest:sessions') || '[]');
    expect(guestSessionsAfterRetry.length).toBe(0);
  });

  it('prevents concurrent execution when another tab holds the cooperative claim lock', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const originalNavigator = globalThis.navigator;
    const mockLocks = {
      request: vi.fn().mockImplementation(async (_name: string, _opts: any, callback: (lock: any) => Promise<any>) => {
        return callback(null);
      }),
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: { ...originalNavigator, locks: mockLocks },
      configurable: true,
      writable: true,
    });

    const success = await service.claim();
    expect(success).toBe(false);

    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('preserves guest records if another tab adds or modifies records right before purge write', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([sampleAttempt]));

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const origVerify = (service as any).verifyRemoteReceipts.bind(service);
    vi.spyOn(service as any, 'verifyRemoteReceipts').mockImplementation(async (...args: any[]) => {
      const verifyResult = await origVerify(...args);

      const modifiedAttempt: PracticeAttempt = {
        ...sampleAttempt,
        userInput: 'Modified concurrently by tab B before purge write',
      };
      const newAttemptFromTabB: PracticeAttempt = {
        id: 'attempt-concurrent-tab-b',
        patternId: 'pattern-tab-b',
        userInput: 'Created concurrently by tab B',
        isValid: true,
        feedback: 'ok',
        timestamp: new Date().toISOString(),
      };
      localStorage.setItem('ecp_guest:attempts', JSON.stringify([modifiedAttempt, newAttemptFromTabB]));

      const newSessionFromTabB: SessionSummary = {
        id: 'session-concurrent-tab-b',
        date: '2026-09-08',
        durationMinutes: 20,
        theme: 'Concurrent Session B',
      };
      const currentSessions = JSON.parse(localStorage.getItem('ecp_guest:sessions') || '[]');
      localStorage.setItem('ecp_guest:sessions', JSON.stringify([...currentSessions, newSessionFromTabB]));

      return verifyResult;
    });

    const success = await service.claim();
    expect(success).toBe(false);

    const guestAttempts = JSON.parse(localStorage.getItem('ecp_guest:attempts') || '[]');
    expect(guestAttempts.length).toBe(2);
    const attemptIds = guestAttempts.map((a: PracticeAttempt) => a.id);
    expect(attemptIds).toContain(sampleAttempt.id);
    expect(attemptIds).toContain('attempt-concurrent-tab-b');

    const preservedModifiedAttempt = guestAttempts.find((a: PracticeAttempt) => a.id === sampleAttempt.id);
    expect(preservedModifiedAttempt.userInput).toBe('Modified concurrently by tab B before purge write');

    const guestSessions = JSON.parse(localStorage.getItem('ecp_guest:sessions') || '[]');
    expect(guestSessions.length).toBe(2);
    const sessionIds = guestSessions.map((s: SessionSummary) => s.id);
    expect(sessionIds).toContain(sampleSession.id);
    expect(sessionIds).toContain('session-concurrent-tab-b');
  });

  it('ensures guest write waits while purge holds the exclusive lock', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([sampleAttempt]));

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    let guestWriteExecuted = false;
    let guestWritePromise: Promise<void> | null = null;

    const originalSave = (service as any).saveGuestAttempts.bind(service);
    vi.spyOn(service as any, 'saveGuestAttempts').mockImplementation((attempts: any) => {
      guestWritePromise = withStorageLock(GUEST_STORAGE_LOCK, async () => {
        guestWriteExecuted = true;
      });
      expect(guestWriteExecuted).toBe(false);
      return originalSave(attempts);
    });

    const success = await service.claim();
    expect(success).toBe(true);
    expect(guestWritePromise).not.toBeNull();
    await guestWritePromise;
    expect(guestWriteExecuted).toBe(true);
  });

  it('ensures purge waits while guest write holds the exclusive lock', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([sampleAttempt]));

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    let releaseGuestWriteLock!: () => void;
    const guestWriteHeld = new Promise<void>((resolve) => {
      releaseGuestWriteLock = resolve;
    });

    let purgeEnteredLock = false;
    let guestWriteActive = false;

    const guestWriteTask = withStorageLock(GUEST_STORAGE_LOCK, async () => {
      guestWriteActive = true;
      await guestWriteHeld;
      guestWriteActive = false;
    });

    const originalSave = (service as any).saveGuestAttempts.bind(service);
    vi.spyOn(service as any, 'saveGuestAttempts').mockImplementation((attempts: any) => {
      purgeEnteredLock = true;
      expect(guestWriteActive).toBe(false);
      return originalSave(attempts);
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(guestWriteActive).toBe(true);

    const claimPromise = service.claim();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(purgeEnteredLock).toBe(false);

    releaseGuestWriteLock();
    await guestWriteTask;

    const claimResult = await claimPromise;
    expect(claimResult).toBe(true);
    expect(purgeEnteredLock).toBe(true);
  });

  it('preserves newly added guest records created before purge without deleting them', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([sampleAttempt]));

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const originalVerify = (service as any).verifyRemoteReceipts.bind(service);
    vi.spyOn(service as any, 'verifyRemoteReceipts').mockImplementation(async (...args: any[]) => {
      const res = await originalVerify(...args);
      const newAttempt: PracticeAttempt = {
        id: 'attempt-brand-new',
        patternId: 'pattern-d',
        userInput: 'Newly added guest attempt before purge',
        isValid: true,
        feedback: 'ok',
        timestamp: new Date().toISOString(),
      };
      const existing = JSON.parse(localStorage.getItem('ecp_guest:attempts') || '[]');
      localStorage.setItem('ecp_guest:attempts', JSON.stringify([...existing, newAttempt]));
      return res;
    });

    const success = await service.claim();
    expect(success).toBe(true);

    const attempts = JSON.parse(localStorage.getItem('ecp_guest:attempts') || '[]');
    expect(attempts.length).toBe(1);
    expect(attempts[0].id).toBe('attempt-brand-new');
  });

  it('preserves modified guest records when content differs from snapshot during purge', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([sampleAttempt]));

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const originalVerify = (service as any).verifyRemoteReceipts.bind(service);
    vi.spyOn(service as any, 'verifyRemoteReceipts').mockImplementation(async (...args: any[]) => {
      const res = await originalVerify(...args);
      const modifiedAttempt: PracticeAttempt = {
        ...sampleAttempt,
        userInput: 'Modified content differing from snapshot',
      };
      localStorage.setItem('ecp_guest:attempts', JSON.stringify([modifiedAttempt]));
      return res;
    });

    const success = await service.claim();
    expect(success).toBe(false);

    const attempts = JSON.parse(localStorage.getItem('ecp_guest:attempts') || '[]');
    expect(attempts.length).toBe(1);
    expect(attempts[0].id).toBe(sampleAttempt.id);
    expect(attempts[0].userInput).toBe('Modified content differing from snapshot');
  });

  it('guarantees purge cannot interleave between guest entity persistence and queueing', async () => {
    const practiceStorage = TestBed.inject(PracticeStorageService);

    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([sampleAttempt]));

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    let purgeRanBeforeQueueing = false;
    let queueingFinished = false;

    const originalPurge = (service as any).executeSafePurge.bind(service);
    vi.spyOn(service as any, 'executeSafePurge').mockImplementation(async (...args: any[]) => {
      if (!queueingFinished) {
        purgeRanBeforeQueueing = true;
      }
      return originalPurge(...args);
    });

    let claimTriggered = false;
    let claimPromise: Promise<boolean> | null = null;
    const originalEnqueue = queueService.enqueue.bind(queueService);

    vi.spyOn(queueService, 'enqueue').mockImplementation((userId: any, entityType: any, payload: any) => {
      if (!claimTriggered) {
        claimTriggered = true;
        claimPromise = service.claim();
      }
      return originalEnqueue(userId, entityType, payload);
    });

    await practiceStorage.saveAttempt({
      patternId: 'pattern-concurrent',
      userInput: 'Concurrent attempt during save',
      isValid: true,
    });
    queueingFinished = true;

    if (claimPromise) {
      await claimPromise;
    }

    expect(purgeRanBeforeQueueing).toBe(false);
  });

  it('halts claim and records FAILED if saveManifest throws on snapshot capture', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    vi.spyOn(service as any, 'saveManifest').mockImplementation(() => {
      throw new Error('QuotaExceededError: storage full');
    });

    const success = await service.claim();
    expect(success).toBe(false);
    expect(service.activeCheckpoint()).toBe('FAILED');
    expect(service.claimError()).toContain('QuotaExceededError');
  });

  it('halts claim and does not progress to LOCAL_MERGED if saveManifest fails at LOCAL_MERGED', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    let storageQuotaExceeded = false;
    const originalSaveManifest = (service as any).saveManifest.bind(service);
    vi.spyOn(service as any, 'saveManifest').mockImplementation((manifest: any) => {
      if (manifest.checkpoint === 'LOCAL_MERGED') {
        storageQuotaExceeded = true;
      }
      if (storageQuotaExceeded) {
        throw new Error('QuotaExceededError: storage is full');
      }
      return originalSaveManifest(manifest);
    });

    const success = await service.claim();
    expect(success).toBe(false);
    expect(service.activeCheckpoint()).toBe('FAILED');
    expect(service.claimError()).toContain('QuotaExceededError');

    const manifestKey = `${GUEST_CLAIM_MANIFEST_KEY_PREFIX}${userA.id}`;
    const durableManifest = JSON.parse(localStorage.getItem(manifestKey)!);
    expect(durableManifest.checkpoint).toBe('SNAPSHOT_CAPTURED');

    vi.restoreAllMocks();
    const retrySuccess = await service.claim();
    expect(retrySuccess).toBe(true);
    expect(service.activeCheckpoint()).toBe('COMPLETED');

    const finalManifest = JSON.parse(localStorage.getItem(manifestKey)!);
    expect(finalManifest.claimId).toBe(durableManifest.claimId);
    expect(finalManifest.sourceFingerprint).toBe(durableManifest.sourceFingerprint);
    expect(finalManifest.checkpoint).toBe('COMPLETED');
  });

  it('resumes from FAILED manifest without replacing snapshot or receipts', async () => {
    const existingManifest: GuestClaimManifest = {
      claimId: 'custom-claim-uuid-999',
      userId: userA.id,
      checkpoint: 'FAILED',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      sourceFingerprint: 'custom-fp-999',
      snapshot: {
        sessions: [sampleSession],
        attempts: [sampleAttempt],
        queueItems: [],
      },
      receipts: {},
      error: 'Previous failure reason',
    };

    localStorage.setItem(`${GUEST_CLAIM_MANIFEST_KEY_PREFIX}${userA.id}`, JSON.stringify(existingManifest));
    currentUserSignal.set(userA);

    const success = await service.reconcile(userA.id);
    expect(success).toBe(true);
    expect(service.activeCheckpoint()).toBe('COMPLETED');

    const manifestKey = `${GUEST_CLAIM_MANIFEST_KEY_PREFIX}${userA.id}`;
    const saved = JSON.parse(localStorage.getItem(manifestKey)!);
    expect(saved.claimId).toBe('custom-claim-uuid-999');
    expect(saved.sourceFingerprint).toBe('custom-fp-999');
    expect(saved.checkpoint).toBe('COMPLETED');
  });

  it('detects remote conflict when only session notes differ', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    mockRemoteSync.requestSync.mockImplementation(async () => {
      const row = mapSessionToDatabaseRow(sampleSession, userA.id);
      mockDbTables.sessions.push({
        ...row,
        notes: 'Different remote notes entirely',
      });
    });

    const success = await service.claim();
    expect(success).toBe(false);
    expect(service.activeCheckpoint()).toBe('PARTIALLY_VERIFIED');

    const manifest = JSON.parse(localStorage.getItem(`${GUEST_CLAIM_MANIFEST_KEY_PREFIX}${userA.id}`)!);
    const receipt = manifest.receipts[makeReceiptKey('session', sampleSession.id)];
    expect(receipt.status).toBe('remote_conflict');
    expect(receipt.userId).toBe(userA.id);
  });

  it('detects remote conflict when each evaluation score differs', async () => {
    const scoresToTest: Array<{ field: keyof ProgressEvaluation; badVal: any }> = [
      { field: 'comprehension', badVal: 1 },
      { field: 'construction', badVal: 1 },
      { field: 'vocabulary', badVal: 1 },
      { field: 'fluency', badVal: 1 },
      { field: 'grammar', badVal: 1 },
      { field: 'pronunciation', badVal: 1 },
      { field: 'newWordsCount', badVal: 99 },
      { field: 'nextGoal', badVal: 'Completely different target' },
    ];

    for (const testCase of scoresToTest) {
      localStorage.clear();
      mockDbTables.sessions = [];
      mockDbTables.progress_evaluations = [];
      mockDbTables.practice_attempts = [];

      localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
      currentUserSignal.set(userA);
      await service.handleUserAuthenticated(userA.id);

      mockRemoteSync.requestSync.mockImplementation(async () => {
        const sRow = mapSessionToDatabaseRow(sampleSession, userA.id);
        mockDbTables.sessions.push(sRow);

        const evalRow = mapEvaluationToDatabaseRow(sampleEval, sampleSession.id, userA.id);
        const colMap: Record<string, string> = {
          comprehension: 'comprehension_score',
          construction: 'construction_score',
          vocabulary: 'vocabulary_score',
          fluency: 'fluency_score',
          grammar: 'grammar_score',
          pronunciation: 'pronunciation_score',
          newWordsCount: 'new_words_count',
          nextGoal: 'next_goal',
        };
        const targetCol = colMap[testCase.field as string];
        mockDbTables.progress_evaluations.push({
          ...evalRow,
          [targetCol]: testCase.badVal,
        });
      });

      const success = await service.claim();
      expect(success).toBe(false);

      const manifest = JSON.parse(localStorage.getItem(`${GUEST_CLAIM_MANIFEST_KEY_PREFIX}${userA.id}`)!);
      const evalReceipt = manifest.receipts[makeReceiptKey('progress_evaluation', sampleSession.id)];
      expect(evalReceipt.status).toBe('remote_conflict');
    }
  });

  it('detects remote conflict when attempt sessionId, timestamp or feedback differs', async () => {
    const attemptDifferences = [
      { key: 'session_id', val: 'different-parent-session-id' },
      { key: 'created_at', val: '2020-01-01T00:00:00Z' },
      { key: 'feedback_status', val: 'needs_practice' },
    ];

    for (const diff of attemptDifferences) {
      localStorage.clear();
      mockDbTables.sessions = [];
      mockDbTables.progress_evaluations = [];
      mockDbTables.practice_attempts = [];

      localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
      localStorage.setItem('ecp_guest:attempts', JSON.stringify([sampleAttempt]));
      currentUserSignal.set(userA);
      await service.handleUserAuthenticated(userA.id);

      mockRemoteSync.requestSync.mockImplementation(async () => {
        mockDbTables.sessions.push(mapSessionToDatabaseRow(sampleSession, userA.id));
        mockDbTables.progress_evaluations.push(mapEvaluationToDatabaseRow(sampleEval, sampleSession.id, userA.id));

        const baseAttemptRow = mapAttemptToDatabaseRow(sampleAttempt, userA.id);
        mockDbTables.practice_attempts.push({
          ...baseAttemptRow,
          [diff.key]: diff.val,
        });
      });

      const success = await service.claim();
      expect(success).toBe(false);

      const manifest = JSON.parse(localStorage.getItem(`${GUEST_CLAIM_MANIFEST_KEY_PREFIX}${userA.id}`)!);
      const attemptReceipt = manifest.receipts[makeReceiptKey('practice_attempt', sampleAttempt.id)];
      expect(attemptReceipt.status).toBe('remote_conflict');
    }
  });

  it('preserves local conflict and orphan receipts without overwriting them during remote verification', async () => {
    const conflictingSession: SessionSummary = {
      ...sampleSession,
      theme: 'User existing theme',
    };
    const userNamespace = getStorageNamespace(userA.id);
    localStorage.setItem(userNamespace.sessionsKey, JSON.stringify([conflictingSession]));
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));

    const orphanAttempt: PracticeAttempt = {
      ...sampleAttempt,
      id: 'attempt-orphan-1',
      sessionId: 'non-existent-session-id',
    };
    localStorage.setItem('ecp_guest:attempts', JSON.stringify([orphanAttempt]));

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    mockRemoteSync.requestSync.mockImplementation(async () => {
      mockDbTables.sessions.push(mapSessionToDatabaseRow(sampleSession, userA.id));
      mockDbTables.practice_attempts.push(mapAttemptToDatabaseRow(orphanAttempt, userA.id));
    });

    const success = await service.claim();
    expect(success).toBe(false);
    expect(service.activeCheckpoint()).toBe('PARTIALLY_VERIFIED');

    const manifest = JSON.parse(localStorage.getItem(`${GUEST_CLAIM_MANIFEST_KEY_PREFIX}${userA.id}`)!);
    const sessionReceipt = manifest.receipts[makeReceiptKey('session', sampleSession.id)];
    expect(sessionReceipt.status).toBe('remote_conflict');

    const orphanReceipt = manifest.receipts[makeReceiptKey('practice_attempt', orphanAttempt.id)];
    expect(orphanReceipt.status).toBe('error');
    expect(orphanReceipt.errorMessage).toContain('Orphan foreign key');
  });

  it('queue purge only removes items matching exact entityType and canonical payload', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    queueService.enqueue(null, 'session', sampleSession);

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    const originalPurge = (service as any).executeSafePurge.bind(service);
    vi.spyOn(service as any, 'executeSafePurge').mockImplementation(async (...args: any[]) => {
      const modifiedSession: SessionSummary = {
        ...sampleSession,
        theme: 'Modified theme after snapshot',
      };
      queueService.enqueue(null, 'session', modifiedSession);

      const unverifiedNewSession: SessionSummary = {
        id: 'session-brand-new',
        date: '2026-09-08',
        durationMinutes: 20,
        theme: 'Brand new session',
      };
      queueService.enqueue(null, 'session', unverifiedNewSession);

      return originalPurge(...args);
    });

    await service.claim();

    const remainingQueue = queueService.getQueue(null);
    expect(remainingQueue.some((q) => (q.payload as SessionSummary).theme === 'Modified theme after snapshot')).toBe(true);
    expect(remainingQueue.some((q) => q.id === 'session-brand-new')).toBe(true);
  });

  it('does not declare COMPLETED if unresolved snapshot entities or queue items remain', async () => {
    localStorage.setItem('ecp_guest:sessions', JSON.stringify([sampleSession]));
    queueService.enqueue(null, 'session', sampleSession);

    currentUserSignal.set(userA);
    await service.handleUserAuthenticated(userA.id);

    vi.spyOn(service as any, 'verifyRemoteReceipts').mockImplementation(async () => {
      return false;
    });

    const success = await service.claim();
    expect(success).toBe(false);
    expect(service.activeCheckpoint()).toBe('PARTIALLY_VERIFIED');
    expect(service.isClaimPromptVisible()).toBe(true);
  });
});
