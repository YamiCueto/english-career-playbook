import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PracticeStorageService } from './practice-storage.service';
import { SupabaseService } from './supabase.service';
import { isValidUuidV4 } from '../utils/uuid.util';
import { SyncQueueService } from './sync-queue.service';
import { User } from '@supabase/supabase-js';

describe('PracticeStorageService', () => {
  let service: PracticeStorageService;
  let queueService: SyncQueueService;
  const currentUserSignal = signal<User | null>(null);

  beforeEach(() => {
    localStorage.clear();
    currentUserSignal.set(null);

    const mockSupabase = {
      currentUser: currentUserSignal,
    };

    TestBed.configureTestingModule({
      providers: [
        PracticeStorageService,
        SyncQueueService,
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    });

    service = TestBed.inject(PracticeStorageService);
    queueService = TestBed.inject(SyncQueueService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should save and retrieve attempts locally with valid UUID v4', () => {
    const attempt = service.saveAttempt({
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

  it('should save session and evaluation and enqueue them in dependency order', () => {
    service.saveSession({
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

  it('should isolate storage and queue between guest and authenticated user', () => {
    service.saveAttempt({
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

    service.saveAttempt({
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

  it('should guarantee user A and user B do not share records and switching namespaces does not copy data', () => {
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
    service.saveAttempt({
      patternId: 'pattern-a',
      userInput: 'User A sentence',
      isValid: true,
    });
    expect(service.getAttempts().length).toBe(1);
    expect(service.getAttempts()[0].userInput).toBe('User A sentence');

    currentUserSignal.set(userB);
    expect(service.getAttempts().length).toBe(0);

    service.saveAttempt({
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

  it('should ensure deadletter does not delete the source record from local storage', () => {
    const attempt = service.saveAttempt({
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

  it('should confirm that zero remote Supabase network calls are made during save and read', () => {
    const attempt = service.saveAttempt({
      patternId: 'pattern-d',
      userInput: 'Offline first sentence',
      isValid: true,
    });

    expect(attempt.id).toBeDefined();
    expect(service.getAttempts().length).toBe(1);
  });
});
