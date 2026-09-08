import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GuestClaimService, GUEST_CLAIM_DECISION_KEY_PREFIX, GUEST_CLAIM_POSTPONED_KEY_PREFIX, GUEST_CLAIM_MANIFEST_KEY_PREFIX } from './guest-claim.service';
import { SupabaseService } from './supabase.service';
import { SyncQueueService } from './sync-queue.service';
import { RemoteSyncService } from './remote-sync.service';
import { SessionSummary, PracticeAttempt, ProgressEvaluation } from '../models/session.model';
import { getStorageNamespace } from '../models/sync.model';
import { signal } from '@angular/core';
import { User } from '@supabase/supabase-js';
import { makeReceiptKey } from '../utils/claim-canonical.util';

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
        const queue = queueService.getQueue(currentUserSignal()?.id || null);
        for (const item of queue) {
          if (item.entityType === 'session') {
            const s = item.payload as SessionSummary;
            mockDbTables.sessions.push({
              id: s.id,
              user_id: currentUserSignal()?.id,
              session_date: s.date,
              focus_theme: s.theme,
              duration_minutes: s.durationMinutes,
              notes: s.notes,
            });
          } else if (item.entityType === 'progress_evaluation') {
            const e = item.payload as ProgressEvaluation & { sessionId: string };
            mockDbTables.progress_evaluations.push({
              session_id: e.sessionId,
              user_id: currentUserSignal()?.id,
              comprehension_score: e.comprehension,
              fluency_score: e.fluency,
            });
          } else if (item.entityType === 'practice_attempt') {
            const a = item.payload as PracticeAttempt;
            mockDbTables.practice_attempts.push({
              id: a.id,
              user_id: currentUserSignal()?.id,
              pattern_id: a.patternId,
              user_input: a.userInput,
              session_id: a.sessionId,
            });
          }
        }
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        GuestClaimService,
        SyncQueueService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: RemoteSyncService, useValue: mockRemoteSync },
      ],
    });

    service = TestBed.inject(GuestClaimService);
    queueService = TestBed.inject(SyncQueueService);
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
});
