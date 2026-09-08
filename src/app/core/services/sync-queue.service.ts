import { Injectable } from '@angular/core';
import {
  SyncQueueItem,
  SyncEntityType,
  SyncStatus,
  getStorageNamespace,
} from '../models/sync.model';

@Injectable({
  providedIn: 'root',
})
export class SyncQueueService {
  enqueue<T extends { id: string }>(
    userId: string | null,
    entityType: SyncEntityType,
    payload: T
  ): SyncQueueItem<T> {
    const namespace = getStorageNamespace(userId);
    const queue = this.getQueue(userId);

    const existingIndex = queue.findIndex((q) => q.id === payload.id && q.entityType === entityType);
    const item: SyncQueueItem<T> = {
      id: payload.id,
      entityType,
      action: 'insert',
      payload,
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
      status: 'pending',
    };

    if (existingIndex >= 0) {
      queue[existingIndex] = item;
    } else {
      queue.push(item);
    }

    this.saveQueue(namespace.queueKey, queue);
    return item;
  }

  getQueue(userId: string | null): SyncQueueItem[] {
    const namespace = getStorageNamespace(userId);
    try {
      const raw = localStorage.getItem(namespace.queueKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  peekOrderedQueue(userId: string | null): SyncQueueItem[] {
    const queue = this.getQueue(userId);
    const priorityMap: Record<SyncEntityType, number> = {
      session: 1,
      progress_evaluation: 2,
      practice_attempt: 3,
    };

    return [...queue].sort((a, b) => {
      const pDiff = (priorityMap[a.entityType] || 99) - (priorityMap[b.entityType] || 99);
      if (pDiff !== 0) {
        return pDiff;
      }
      return a.enqueuedAt.localeCompare(b.enqueuedAt);
    });
  }

  removeItem(userId: string | null, itemId: string): void {
    const namespace = getStorageNamespace(userId);
    const queue = this.getQueue(userId).filter((item) => item.id !== itemId);
    this.saveQueue(namespace.queueKey, queue);
  }

  removeExactItem(
    userId: string | null,
    entityType: SyncEntityType,
    itemId: string
  ): boolean {
    const namespace = getStorageNamespace(userId);
    const queue = this.getQueue(userId);
    const index = queue.findIndex((item) => item.id === itemId && item.entityType === entityType);
    if (index >= 0) {
      queue.splice(index, 1);
      this.saveQueue(namespace.queueKey, queue);
      return true;
    }
    return false;
  }

  setQueue(userId: string | null, queue: SyncQueueItem[]): void {
    const namespace = getStorageNamespace(userId);
    this.saveQueue(namespace.queueKey, queue);
  }

  updateItem(
    userId: string | null,
    itemId: string,
    updates: Partial<SyncQueueItem>
  ): void {
    const namespace = getStorageNamespace(userId);
    const queue = this.getQueue(userId);
    const index = queue.findIndex((item) => item.id === itemId);
    if (index >= 0) {
      queue[index] = {
        ...queue[index],
        ...updates,
      };
      this.saveQueue(namespace.queueKey, queue);
    }
  }

  moveToDeadletter(userId: string | null, itemId: string, error: string): void {
    const namespace = getStorageNamespace(userId);
    const queue = this.getQueue(userId);
    const targetItem = queue.find((item) => item.id === itemId);
    if (!targetItem) {
      return;
    }

    const filteredQueue = queue.filter((item) => item.id !== itemId);
    this.saveQueue(namespace.queueKey, filteredQueue);

    const deadletter = this.getDeadletter(userId);
    deadletter.push({
      ...targetItem,
      status: 'error',
      lastError: error,
    });
    localStorage.setItem(namespace.deadletterKey, JSON.stringify(deadletter));
  }

  getDeadletter(userId: string | null): SyncQueueItem[] {
    const namespace = getStorageNamespace(userId);
    try {
      const raw = localStorage.getItem(namespace.deadletterKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  clearQueue(userId: string | null): void {
    const namespace = getStorageNamespace(userId);
    localStorage.removeItem(namespace.queueKey);
  }

  private saveQueue(key: string, queue: SyncQueueItem[]): void {
    localStorage.setItem(key, JSON.stringify(queue));
  }
}
