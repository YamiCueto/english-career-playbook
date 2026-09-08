import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withStorageLock, clearInMemoryLocks, GUEST_STORAGE_LOCK, getUserStorageLock, getClaimLock } from './storage-lock.util';

describe('storage-lock.util', () => {
  beforeEach(() => {
    clearInMemoryLocks();
  });

  afterEach(() => {
    clearInMemoryLocks();
  });

  it('should execute operation and return result under lock', async () => {
    const result = await withStorageLock(GUEST_STORAGE_LOCK, async () => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('should serialize concurrent operations under same lock name', async () => {
    const executionOrder: number[] = [];
    let resolveFirst!: () => void;
    const firstBlocker = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const op1 = withStorageLock(GUEST_STORAGE_LOCK, async () => {
      executionOrder.push(1);
      await firstBlocker;
      executionOrder.push(2);
      return 'op1';
    });

    const op2 = withStorageLock(GUEST_STORAGE_LOCK, async () => {
      executionOrder.push(3);
      return 'op2';
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(executionOrder).toEqual([1]);

    resolveFirst();
    const [res1, res2] = await Promise.all([op1, op2]);

    expect(res1).toBe('op1');
    expect(res2).toBe('op2');
    expect(executionOrder).toEqual([1, 2, 3]);
  });

  it('should allow concurrent operations under different lock names', async () => {
    const executedLocks: string[] = [];

    let resolveA!: () => void;
    const blockerA = new Promise<void>((resolve) => {
      resolveA = resolve;
    });

    const opA = withStorageLock('lock_a', async () => {
      executedLocks.push('start_a');
      await blockerA;
      executedLocks.push('end_a');
    });

    const opB = withStorageLock('lock_b', async () => {
      executedLocks.push('start_b');
      executedLocks.push('end_b');
    });

    await opB;
    expect(executedLocks).toContain('start_b');
    expect(executedLocks).toContain('end_b');

    resolveA();
    await opA;
    expect(executedLocks).toContain('end_a');
  });

  it('should propagate errors and release lock for subsequent operations', async () => {
    const failedOp = withStorageLock(GUEST_STORAGE_LOCK, async () => {
      throw new Error('Lock internal failure');
    });

    await expect(failedOp).rejects.toThrow('Lock internal failure');

    const nextOp = await withStorageLock(GUEST_STORAGE_LOCK, async () => {
      return 'recovered';
    });

    expect(nextOp).toBe('recovered');
  });

  it('should serialize operations using in-memory fallback when navigator.locks is unavailable', async () => {
    const originalNavigatorLocks = (navigator as unknown as { locks?: unknown }).locks;
    try {
      Object.defineProperty(navigator, 'locks', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const order: number[] = [];
      let resolveFirst!: () => void;
      const blocker = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      const first = withStorageLock('fallback_test_lock', async () => {
        order.push(1);
        await blocker;
        order.push(2);
      });

      const second = withStorageLock('fallback_test_lock', async () => {
        order.push(3);
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(order).toEqual([1]);

      resolveFirst();
      await Promise.all([first, second]);
      expect(order).toEqual([1, 2, 3]);
    } finally {
      Object.defineProperty(navigator, 'locks', {
        value: originalNavigatorLocks,
        configurable: true,
        writable: true,
      });
    }
  });

  it('should propagate errors and release in-memory fallback lock for subsequent operations', async () => {
    const originalNavigatorLocks = (navigator as unknown as { locks?: unknown }).locks;
    try {
      Object.defineProperty(navigator, 'locks', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const failedOp = withStorageLock('fallback_error_lock', async () => {
        throw new Error('Fallback failure');
      });

      await expect(failedOp).rejects.toThrow('Fallback failure');

      const nextOp = await withStorageLock('fallback_error_lock', async () => {
        return 'fallback_recovered';
      });

      expect(nextOp).toBe('fallback_recovered');
    } finally {
      Object.defineProperty(navigator, 'locks', {
        value: originalNavigatorLocks,
        configurable: true,
        writable: true,
      });
    }
  });

  it('generates predictable lock names for user storage and claim', () => {
    expect(getUserStorageLock('user-123')).toBe('ecp_user_storage_user-123');
    expect(getClaimLock('user-123')).toBe('ecp_claim_user-123');
  });
});
