import { TestBed } from '@angular/core/testing';
import { SyncQueueService } from './sync-queue.service';
import { getStorageNamespace } from '../models/sync.model';

describe('SyncQueueService', () => {
  let service: SyncQueueService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(SyncQueueService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should isolate queues between guest and authenticated users', () => {
    const userA = 'user-aaa-111';
    const userB = 'user-bbb-222';

    service.enqueue(null, 'practice_attempt', { id: 'attempt-guest-1' });
    service.enqueue(userA, 'practice_attempt', { id: 'attempt-userA-1' });
    service.enqueue(userB, 'practice_attempt', { id: 'attempt-userB-1' });

    const guestQueue = service.getQueue(null);
    const userAQueue = service.getQueue(userA);
    const userBQueue = service.getQueue(userB);

    expect(guestQueue.length).toBe(1);
    expect(guestQueue[0].id).toBe('attempt-guest-1');

    expect(userAQueue.length).toBe(1);
    expect(userAQueue[0].id).toBe('attempt-userA-1');

    expect(userBQueue.length).toBe(1);
    expect(userBQueue[0].id).toBe('attempt-userB-1');

    expect(localStorage.getItem(getStorageNamespace(null).queueKey)).toBeDefined();
    expect(localStorage.getItem(getStorageNamespace(userA).queueKey)).toBeDefined();
    expect(localStorage.getItem(getStorageNamespace(userB).queueKey)).toBeDefined();
  });

  it('should deduplicate items with the same id and entityType in queue', () => {
    const user = 'user-123';
    service.enqueue(user, 'practice_attempt', { id: 'att-1', note: 'v1' });
    service.enqueue(user, 'practice_attempt', { id: 'att-1', note: 'v2' });

    const queue = service.getQueue(user);
    expect(queue.length).toBe(1);
    expect((queue[0].payload as { note: string }).note).toBe('v2');
  });

  it('should return queued items ordered by relational dependency: session -> evaluation -> attempt', () => {
    const user = 'user-123';

    service.enqueue(user, 'practice_attempt', { id: 'attempt-1' });
    service.enqueue(user, 'progress_evaluation', { id: 'eval-1' });
    service.enqueue(user, 'session', { id: 'session-1' });
    service.enqueue(user, 'practice_attempt', { id: 'attempt-2' });

    const ordered = service.peekOrderedQueue(user);

    expect(ordered.map((item) => item.entityType)).toEqual([
      'session',
      'progress_evaluation',
      'practice_attempt',
      'practice_attempt',
    ]);
    expect(ordered[0].id).toBe('session-1');
    expect(ordered[1].id).toBe('eval-1');
  });

  it('should move problematic items to deadletter', () => {
    const user = 'user-123';
    service.enqueue(user, 'practice_attempt', { id: 'att-fail' });

    service.moveToDeadletter(user, 'att-fail', 'RLS check failed: 42501');

    const activeQueue = service.getQueue(user);
    expect(activeQueue.length).toBe(0);

    const deadletter = service.getDeadletter(user);
    expect(deadletter.length).toBe(1);
    expect(deadletter[0].id).toBe('att-fail');
    expect(deadletter[0].status).toBe('error');
    expect(deadletter[0].lastError).toContain('42501');
  });

  it('should remove exact item matching id and entityType without removing other entity types with same id', () => {
    const user = 'user-123';
    service.enqueue(user, 'session', { id: 'shared-id', date: '2026-09-08' });
    service.enqueue(user, 'progress_evaluation', { id: 'shared-id', comprehension: 5 });

    expect(service.getQueue(user).length).toBe(2);

    const removed = service.removeExactItem(user, 'progress_evaluation', 'shared-id');
    expect(removed).toBe(true);

    const remaining = service.getQueue(user);
    expect(remaining.length).toBe(1);
    expect(remaining[0].entityType).toBe('session');
    expect(remaining[0].id).toBe('shared-id');
  });

  it('should overwrite entire queue with setQueue in single write', () => {
    const user = 'user-123';
    service.enqueue(user, 'session', { id: 's-1' });
    service.enqueue(user, 'session', { id: 's-2' });

    expect(service.getQueue(user).length).toBe(2);

    service.setQueue(user, []);
    expect(service.getQueue(user).length).toBe(0);
  });
});
