export const GUEST_STORAGE_LOCK = 'ecp_guest_storage';

export function getUserStorageLock(userId: string): string {
  return `ecp_user_storage_${userId}`;
}

export function getClaimLock(userId: string): string {
  return `ecp_claim_${userId}`;
}

const inMemoryLocks = new Map<string, Promise<void>>();

export async function withStorageLock<T>(
  lockName: string,
  operation: () => Promise<T> | T
): Promise<T> {
  if (
    typeof navigator !== 'undefined' &&
    'locks' in navigator &&
    typeof navigator.locks?.request === 'function'
  ) {
    let callbackInvoked = false;
    try {
      return await navigator.locks.request(lockName, { mode: 'exclusive' }, async () => {
        callbackInvoked = true;
        return await operation();
      });
    } catch (err) {
      if (callbackInvoked) {
        throw err;
      }
      return await executeWithInMemoryLock(lockName, operation);
    }
  }

  return await executeWithInMemoryLock(lockName, operation);
}

async function executeWithInMemoryLock<T>(
  lockName: string,
  operation: () => Promise<T> | T
): Promise<T> {
  const prev = inMemoryLocks.get(lockName) ?? Promise.resolve();
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  inMemoryLocks.set(lockName, next);

  try {
    await prev;
    return await operation();
  } finally {
    release();
    if (inMemoryLocks.get(lockName) === next) {
      inMemoryLocks.delete(lockName);
    }
  }
}

export function clearInMemoryLocks(): void {
  inMemoryLocks.clear();
}
