import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { RemoteSyncService } from './remote-sync.service';
import { SupabaseService } from './supabase.service';
import { SyncQueueService } from './sync-queue.service';
import { getStorageNamespace } from '../models/sync.model';
import { PracticeAttempt, SessionSummary, ProgressEvaluation } from '../models/session.model';
import { User } from '@supabase/supabase-js';

describe('RemoteSyncService', () => {
  let service: RemoteSyncService;
  let queueService: SyncQueueService;
  const currentUserSignal = signal<User | null>(null);

  let mockClient: any;
  let fromSpy: any;

  beforeEach(() => {
    localStorage.clear();
    currentUserSignal.set(null);

    mockClient = {
      from: (table: string) => {
        return createTableMock(table);
      },
    };

    const mockSupabase = {
      currentUser: currentUserSignal,
      get client() {
        return mockClient;
      },
      get isConfigured() {
        return true;
      },
      get isAuthenticated() {
        return currentUserSignal() !== null;
      },
    };

    TestBed.configureTestingModule({
      providers: [
        RemoteSyncService,
        SyncQueueService,
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    });

    service = TestBed.inject(RemoteSyncService);
    queueService = TestBed.inject(SyncQueueService);
  });

  afterEach(() => {
    service.handleSignOut();
    localStorage.clear();
  });

  function makeQueryBuilder(config: {
    maybeSingle?: (val?: any) => Promise<any>;
    range?: (from: number, to: number) => Promise<any>;
  } = {}) {
    let lastEqVal: any = null;
    const builder: any = {
      eq: (_col: string, val: any) => {
        lastEqVal = val;
        return builder;
      },
      order: () => builder,
      maybeSingle: async () => (config.maybeSingle ? config.maybeSingle(lastEqVal) : { data: null, error: null }),
      range: async (from: number, to: number) => (config.range ? config.range(from, to) : { data: [], error: null }),
    };
    return builder;
  }

  function createTableMock(table: string) {
    return {
      insert: async (row: any) => ({ error: null }),
      select: (cols = '*') => makeQueryBuilder(),
    };
  }

  it('1. push exitoso session -> evaluation -> attempt en orden relacional', async () => {
    const userId = 'usr-111';
    const executionOrder: string[] = [];

    const mockSessions: any[] = [];
    const mockAttempts: any[] = [];
    const mockEvaluations: any[] = [];

    mockClient.from = (table: string) => {
      return {
        insert: async (row: any) => {
          executionOrder.push(`insert:${table}`);
          if (table === 'sessions') mockSessions.push(row);
          if (table === 'progress_evaluations') mockEvaluations.push(row);
          if (table === 'practice_attempts') mockAttempts.push(row);
          return { error: null };
        },
        select: (cols = '*') =>
          makeQueryBuilder({
            maybeSingle: async (val: any) => {
              if (table === 'sessions') return { data: mockSessions.find((s) => s.id === val), error: null };
              if (table === 'progress_evaluations') return { data: mockEvaluations.find((e) => e.session_id === val), error: null };
              if (table === 'practice_attempts') return { data: mockAttempts.find((a) => a.id === val), error: null };
              return { data: null, error: null };
            },
          }),
      };
    };

    const session: SessionSummary = {
      id: 'sess-1',
      date: '2026-09-07',
      durationMinutes: 40,
      theme: 'Architecture',
    };
    const evaluation: ProgressEvaluation & { id: string; sessionId: string } = {
      id: 'eval-1',
      sessionId: 'sess-1',
      comprehension: 5,
      construction: 5,
      vocabulary: 4,
      fluency: 4,
      grammar: 4,
      pronunciation: 4,
      newWordsCount: 5,
      nextGoal: 'Refine fluency',
    };
    const attempt: PracticeAttempt = {
      id: 'att-1',
      patternId: 'pattern-a',
      userInput: 'I work with distributed systems',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
      sessionId: 'sess-1',
    };

    queueService.enqueue(userId, 'practice_attempt', attempt);
    queueService.enqueue(userId, 'progress_evaluation', evaluation);
    queueService.enqueue(userId, 'session', session);

    currentUserSignal.set({ id: userId } as User);
    await service.handleSignIn(userId);

    expect(executionOrder).toEqual([
      'insert:sessions',
      'insert:progress_evaluations',
      'insert:practice_attempts',
    ]);
    expect(queueService.getQueue(userId).length).toBe(0);
    expect(service.syncStatus()).toBe('synced');
  });

  it('2. retry de la misma fila sin duplicación lógica ante corte de red previo', async () => {
    const userId = 'usr-111';
    const existingRow = {
      id: 'att-retry-1',
      user_id: userId,
      pattern_id: 'pattern-a',
      user_input: 'I design APIs',
      feedback_status: 'valid',
      created_at: '2026-09-07T12:00:00.000Z',
    };

    mockClient.from = (table: string) => ({
      insert: async (row: any) => ({
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      }),
      select: () => makeQueryBuilder({ maybeSingle: async () => ({ data: existingRow, error: null }) }),
    });

    const attempt: PracticeAttempt = {
      id: 'att-retry-1',
      patternId: 'pattern-a',
      userInput: 'I design APIs',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
    };

    queueService.enqueue(userId, 'practice_attempt', attempt);
    currentUserSignal.set({ id: userId } as User);
    await service.handleSignIn(userId);

    expect(queueService.getQueue(userId).length).toBe(0);
    expect(service.syncStatus()).toBe('synced');
  });

  it('3. conflicto de mismo UUID con contenido distinto no sobrescribe y marca conflict', async () => {
    const userId = 'usr-111';
    const remoteDifferentRow = {
      id: 'att-conflict-1',
      user_id: userId,
      pattern_id: 'pattern-a',
      user_input: 'Different remote sentence already saved',
      feedback_status: 'valid',
    };

    mockClient.from = (table: string) => ({
      insert: async (row: any) => ({
        error: { code: '23505', message: 'duplicate key' },
      }),
      select: () => makeQueryBuilder({ maybeSingle: async () => ({ data: remoteDifferentRow, error: null }) }),
    });

    const attempt: PracticeAttempt = {
      id: 'att-conflict-1',
      patternId: 'pattern-a',
      userInput: 'Local sentence attempting sync',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
    };

    const namespace = getStorageNamespace(userId);
    localStorage.setItem(namespace.attemptsKey, JSON.stringify([attempt]));
    queueService.enqueue(userId, 'practice_attempt', attempt);

    currentUserSignal.set({ id: userId } as User);
    await service.handleSignIn(userId);

    expect(service.syncStatus()).toBe('conflict');
    const queue = queueService.getQueue(userId);
    expect(queue.length).toBe(1);
    expect(queue[0].status).toBe('conflict');

    const storedAttempts = JSON.parse(localStorage.getItem(namespace.attemptsKey) || '[]');
    expect(storedAttempts[0].syncStatus).toBe('conflict');
    expect(storedAttempts[0].userInput).toBe('Local sentence attempting sync');
  });

  it('4. mismo UUID con contenido idéntico tratado como confirmado', async () => {
    const userId = 'usr-111';
    const remoteIdenticalRow = {
      id: 'att-same-1',
      user_id: userId,
      pattern_id: 'pattern-b',
      user_input: 'Identical sentence',
      feedback_status: 'valid',
    };

    mockClient.from = (table: string) => ({
      insert: async () => ({
        error: { code: '23505', message: 'duplicate key' },
      }),
      select: () => makeQueryBuilder({ maybeSingle: async () => ({ data: remoteIdenticalRow, error: null }) }),
    });

    const attempt: PracticeAttempt = {
      id: 'att-same-1',
      patternId: 'pattern-b',
      userInput: 'Identical sentence',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
    };

    queueService.enqueue(userId, 'practice_attempt', attempt);
    currentUserSignal.set({ id: userId } as User);
    await service.handleSignIn(userId);

    expect(queueService.getQueue(userId).length).toBe(0);
    expect(service.syncStatus()).toBe('synced');
  });

  it('5. fallo de red mantiene pending sin romper el estado local', async () => {
    const userId = 'usr-111';
    mockClient.from = () => ({
      insert: async () => ({
        error: { code: 'NETWORK_ERROR', message: 'Failed to fetch' },
      }),
      select: () => makeQueryBuilder(),
    });

    const attempt: PracticeAttempt = {
      id: 'att-offline-1',
      patternId: 'pattern-a',
      userInput: 'Offline sentence',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
    };

    queueService.enqueue(userId, 'practice_attempt', attempt);
    currentUserSignal.set({ id: userId } as User);
    await service.handleSignIn(userId);

    const queue = queueService.getQueue(userId);
    expect(queue.length).toBe(1);
    expect(queue[0].status).toBe('pending');
    expect(queue[0].retryCount).toBe(1);
    expect(service.syncStatus()).toBe('pending');
  });

  it('6. error permanente pasa a deadletter sin borrar el registro fuente', async () => {
    const userId = 'usr-111';
    mockClient.from = () => ({
      insert: async () => ({
        error: { code: '42501', message: 'permission denied for table practice_attempts' },
      }),
      select: () => makeQueryBuilder(),
    });

    const attempt: PracticeAttempt = {
      id: 'att-perm-fail',
      patternId: 'pattern-a',
      userInput: 'Sentence causing RLS violation',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
    };

    const namespace = getStorageNamespace(userId);
    localStorage.setItem(namespace.attemptsKey, JSON.stringify([attempt]));
    queueService.enqueue(userId, 'practice_attempt', attempt);

    currentUserSignal.set({ id: userId } as User);
    await service.handleSignIn(userId);

    expect(queueService.getQueue(userId).length).toBe(0);
    const deadletter = queueService.getDeadletter(userId);
    expect(deadletter.length).toBe(1);
    expect(deadletter[0].id).toBe('att-perm-fail');
    expect(service.syncStatus()).toBe('error');

    const localAttempts = JSON.parse(localStorage.getItem(namespace.attemptsKey) || '[]');
    expect(localAttempts.length).toBe(1);
    expect(localAttempts[0].id).toBe('att-perm-fail');
    expect(localAttempts[0].syncStatus).toBe('error');
  });

  it('7. respuesta tardía después de logout es ignorada por guardia de sesión', async () => {
    const userId = 'usr-111';
    let delayedResolve: (val: any) => void;
    const delayedPromise = new Promise((resolve) => {
      delayedResolve = resolve;
    });

    mockClient.from = () => ({
      insert: () => delayedPromise,
    });

    const attempt: PracticeAttempt = {
      id: 'att-delayed-1',
      patternId: 'pattern-a',
      userInput: 'Delayed sentence',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
    };

    queueService.enqueue(userId, 'practice_attempt', attempt);
    currentUserSignal.set({ id: userId } as User);

    const syncPromise = service.handleSignIn(userId);

    service.handleSignOut();
    expect(service.currentUserId).toBeNull();
    expect(service.syncStatus()).toBe('local');

    delayedResolve!({ error: null });
    await syncPromise;

    expect(service.currentUserId).toBeNull();
    expect(service.syncStatus()).toBe('local');
  });

  it('8. usuario A nunca procesa cola de usuario B', async () => {
    const userA = 'user-A';
    const userB = 'user-B';

    queueService.enqueue(userB, 'practice_attempt', {
      id: 'att-userB',
      patternId: 'pattern-a',
      userInput: 'User B sentence',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
    });

    let userAInsertCalled = false;
    mockClient.from = () => ({
      insert: async () => {
        userAInsertCalled = true;
        return { error: null };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          range: async () => ({ data: [], error: null }),
        }),
      }),
    });

    currentUserSignal.set({ id: userA } as User);
    await service.handleSignIn(userA);

    expect(userAInsertCalled).toBe(false);
    expect(queueService.getQueue(userB).length).toBe(1);
    expect(queueService.getQueue(userB)[0].id).toBe('att-userB');
  });

  it('9. pull paginado completo descarga todas las páginas sin límite silencioso', async () => {
    const userId = 'usr-111';

    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `p1-att-${i}`,
      user_id: userId,
      pattern_id: 'pattern-a',
      user_input: `Sentence p1 ${i}`,
      feedback_status: 'valid',
      created_at: `2026-09-07T10:${String(i).padStart(2, '0')}:00.000Z`,
    }));

    const page2 = Array.from({ length: 35 }, (_, i) => ({
      id: `p2-att-${i}`,
      user_id: userId,
      pattern_id: 'pattern-b',
      user_input: `Sentence p2 ${i}`,
      feedback_status: 'valid',
      created_at: `2026-09-07T11:${String(i).padStart(2, '0')}:00.000Z`,
    }));

    mockClient.from = (table: string) => ({
      select: () =>
        makeQueryBuilder({
          range: async (from: number, to: number) => {
            if (table === 'practice_attempts') {
              if (from === 0) return { data: page1, error: null };
              if (from === 100) return { data: page2, error: null };
              return { data: [], error: null };
            }
            return { data: [], error: null };
          },
        }),
    });

    currentUserSignal.set({ id: userId } as User);
    await service.pull(userId);

    const namespace = getStorageNamespace(userId);
    const storedAttempts = JSON.parse(localStorage.getItem(namespace.attemptsKey) || '[]');
    expect(storedAttempts.length).toBe(135);
  });

  it('10. pull no sobrescribe registros locales con status pending o conflict', async () => {
    const userId = 'usr-111';
    const namespace = getStorageNamespace(userId);

    const localConflictAttempt: PracticeAttempt = {
      id: 'att-overlap',
      patternId: 'pattern-a',
      userInput: 'Local offline edition',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
      syncStatus: 'conflict',
    };
    localStorage.setItem(namespace.attemptsKey, JSON.stringify([localConflictAttempt]));

    const remoteRow = {
      id: 'att-overlap',
      user_id: userId,
      pattern_id: 'pattern-a',
      user_input: 'Older remote version',
      feedback_status: 'valid',
      created_at: '2026-09-07T10:00:00.000Z',
    };

    mockClient.from = () => ({
      select: () => makeQueryBuilder({ range: async () => ({ data: [remoteRow], error: null }) }),
    });

    currentUserSignal.set({ id: userId } as User);
    await service.pull(userId);

    const storedAttempts = JSON.parse(localStorage.getItem(namespace.attemptsKey) || '[]');
    expect(storedAttempts.length).toBe(1);
    expect(storedAttempts[0].userInput).toBe('Local offline edition');
    expect(storedAttempts[0].syncStatus).toBe('conflict');
  });

  it('11. login no reclama ni copia datos de guest en este incremento', async () => {
    const userId = 'usr-111';
    const guestNamespace = getStorageNamespace(null);

    const guestAttempt: PracticeAttempt = {
      id: 'guest-att-99',
      patternId: 'pattern-a',
      userInput: 'Strictly guest sentence',
      timestamp: '2026-09-07T08:00:00.000Z',
      isValid: true,
    };
    localStorage.setItem(guestNamespace.attemptsKey, JSON.stringify([guestAttempt]));
    queueService.enqueue(null, 'practice_attempt', guestAttempt);

    mockClient.from = () => ({
      select: () => makeQueryBuilder(),
      insert: async () => ({ error: null }),
    });

    currentUserSignal.set({ id: userId } as User);
    await service.handleSignIn(userId);

    const preservedGuestAttempts = JSON.parse(localStorage.getItem(guestNamespace.attemptsKey) || '[]');
    expect(preservedGuestAttempts.length).toBe(1);
    expect(preservedGuestAttempts[0].id).toBe('guest-att-99');
    expect(queueService.getQueue(null).length).toBe(1);

    const userNamespace = getStorageNamespace(userId);
    const userAttempts = JSON.parse(localStorage.getItem(userNamespace.attemptsKey) || '[]');
    expect(userAttempts.length).toBe(0);
    expect(queueService.getQueue(userId).length).toBe(0);
  });

  it('12. cambio de usuario A -> B limpia memoria y carga únicamente namespace de B', async () => {
    const userA = 'user-A';
    const userB = 'user-B';

    const nsA = getStorageNamespace(userA);
    const nsB = getStorageNamespace(userB);

    localStorage.setItem(nsA.attemptsKey, JSON.stringify([{ id: 'att-A', patternId: 'pattern-a', userInput: 'A sentence', timestamp: '2026-09-07T10:00:00.000Z', isValid: true, syncStatus: 'synced' }]));
    localStorage.setItem(nsB.attemptsKey, JSON.stringify([{ id: 'att-B', patternId: 'pattern-b', userInput: 'B sentence', timestamp: '2026-09-07T11:00:00.000Z', isValid: true, syncStatus: 'synced' }]));

    mockClient.from = () => ({
      select: () => makeQueryBuilder(),
      insert: async () => ({ error: null }),
    });

    currentUserSignal.set({ id: userA } as User);
    await service.handleSignIn(userA);
    expect(service.currentUserId).toBe(userA);

    service.handleSignOut();
    expect(service.currentUserId).toBeNull();
    expect(service.syncStatus()).toBe('local');

    currentUserSignal.set({ id: userB } as User);
    await service.handleSignIn(userB);
    expect(service.currentUserId).toBe(userB);

    const attemptsB = JSON.parse(localStorage.getItem(nsB.attemptsKey) || '[]');
    expect(attemptsB.length).toBe(1);
    expect(attemptsB[0].id).toBe('att-B');
  });

  it('13. ausencia de Web Locks permite ejecución directa sin romper idempotencia', async () => {
    const userId = 'usr-111';
    const originalLocks = (navigator as any).locks;
    (navigator as any).locks = undefined;

    try {
      let insertCalls = 0;
      mockClient.from = () => ({
        insert: async () => {
          insertCalls++;
          return { error: null };
        },
        select: () =>
          makeQueryBuilder({
            maybeSingle: async () => ({
              data: { id: 'att-no-lock', user_id: userId, pattern_id: 'pattern-a', user_input: 'Text' },
              error: null,
            }),
          }),
      });

      queueService.enqueue(userId, 'practice_attempt', {
        id: 'att-no-lock',
        patternId: 'pattern-a',
        userInput: 'Text',
        timestamp: '2026-09-07T12:00:00.000Z',
        isValid: true,
      });

      currentUserSignal.set({ id: userId } as User);
      await service.handleSignIn(userId);

      expect(insertCalls).toBe(1);
      expect(queueService.getQueue(userId).length).toBe(0);
      expect(service.syncStatus()).toBe('synced');
    } finally {
      (navigator as any).locks = originalLocks;
    }
  });

  it('14. pull clasifica como conflicto si encuentra remoto con mismo UUID pero contenido diferente a un pending local', async () => {
    const userId = 'usr-111';
    const namespace = getStorageNamespace(userId);

    const localPendingAttempt: PracticeAttempt = {
      id: 'att-conflict-pull',
      patternId: 'pattern-a',
      userInput: 'Local pending version',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
      syncStatus: 'pending',
    };
    localStorage.setItem(namespace.attemptsKey, JSON.stringify([localPendingAttempt]));
    queueService.enqueue(userId, 'practice_attempt', localPendingAttempt);

    const remoteRow = {
      id: 'att-conflict-pull',
      user_id: userId,
      pattern_id: 'pattern-a',
      user_input: 'Completely different remote version',
      feedback_status: 'valid',
      created_at: '2026-09-07T10:00:00.000Z',
    };

    mockClient.from = () => ({
      select: () => makeQueryBuilder({ range: async () => ({ data: [remoteRow], error: null }) }),
    });

    currentUserSignal.set({ id: userId } as User);
    await service.pull(userId);

    const storedAttempts = JSON.parse(localStorage.getItem(namespace.attemptsKey) || '[]');
    expect(storedAttempts.length).toBe(1);
    expect(storedAttempts[0].userInput).toBe('Local pending version');
    expect(storedAttempts[0].syncStatus).toBe('conflict');

    const queue = queueService.getQueue(userId);
    expect(queue.length).toBe(1);
    expect(queue[0].status).toBe('conflict');
    expect(service.syncStatus()).toBe('conflict');
  });

  it('15. confirmación remota no elimina mutación pendiente más reciente si fue reemplazada durante la sincronización', async () => {
    const userId = 'usr-111';
    const attemptV1: PracticeAttempt = {
      id: 'att-race-1',
      patternId: 'pattern-a',
      userInput: 'Version 1 in flight',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
    };
    const attemptV2: PracticeAttempt = {
      id: 'att-race-1',
      patternId: 'pattern-a',
      userInput: 'Version 2 edited while in flight',
      timestamp: '2026-09-07T12:01:00.000Z',
      isValid: true,
    };

    queueService.enqueue(userId, 'practice_attempt', attemptV1);

    mockClient.from = () => ({
      insert: async () => {
        queueService.enqueue(userId, 'practice_attempt', attemptV2);
        return { error: null };
      },
      select: () =>
        makeQueryBuilder({
          maybeSingle: async () => ({
            data: {
              id: 'att-race-1',
              user_id: userId,
              pattern_id: 'pattern-a',
              user_input: 'Version 1 in flight',
              feedback_status: 'valid',
            },
            error: null,
          }),
        }),
    });

    currentUserSignal.set({ id: userId } as User);
    await service.handleSignIn(userId);

    const queue = queueService.getQueue(userId);
    expect(queue.length).toBe(1);
    expect((queue[0].payload as PracticeAttempt).userInput).toBe('Version 2 edited while in flight');
  });

  it('16. error permanente por mensaje RLS o check constraint sin codigo 42501 pasa a deadletter', async () => {
    const userId = 'usr-111';
    mockClient.from = () => ({
      insert: async () => ({
        error: { message: 'new row violates row-level security policy for table practice_attempts' },
      }),
      select: () => makeQueryBuilder(),
    });

    const attempt: PracticeAttempt = {
      id: 'att-rls-msg',
      patternId: 'pattern-a',
      userInput: 'Sentence rejected by RLS policy message',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
    };

    const namespace = getStorageNamespace(userId);
    localStorage.setItem(namespace.attemptsKey, JSON.stringify([attempt]));
    queueService.enqueue(userId, 'practice_attempt', attempt);

    currentUserSignal.set({ id: userId } as User);
    await service.handleSignIn(userId);

    expect(queueService.getQueue(userId).length).toBe(0);
    const deadletter = queueService.getDeadletter(userId);
    expect(deadletter.length).toBe(1);
    expect(deadletter[0].id).toBe('att-rls-msg');
    expect(service.syncStatus()).toBe('error');
  });

  it('17. falla en almacenamiento local preserva el registro pendiente en la cola', async () => {
    const userId = 'usr-111';
    const namespace = getStorageNamespace(userId);

    const attempt: PracticeAttempt = {
      id: 'att-quota-fail',
      patternId: 'pattern-a',
      userInput: 'Quota sentence',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
    };

    localStorage.setItem(namespace.attemptsKey, JSON.stringify([attempt]));
    queueService.enqueue(userId, 'practice_attempt', attempt);

    mockClient.from = () => ({
      insert: async () => ({ error: null }),
      select: () =>
        makeQueryBuilder({
          maybeSingle: async () => ({
            data: {
              id: 'att-quota-fail',
              user_id: userId,
              pattern_id: 'pattern-a',
              user_input: 'Quota sentence',
              feedback_status: 'valid',
            },
            error: null,
          }),
        }),
    });

    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === namespace.attemptsKey && value.includes('synced')) {
          throw new Error('QuotaExceededError');
        }
        return Storage.prototype.setItem.call(this, key, value);
      });

    try {
      currentUserSignal.set({ id: userId } as User);
      await service.handleSignIn(userId);

      const queue = queueService.getQueue(userId);
      expect(queue.length).toBe(1);
      expect(queue[0].id).toBe('att-quota-fail');
    } finally {
      setItemSpy.mockRestore();
    }
  });
});
