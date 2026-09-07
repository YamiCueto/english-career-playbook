import { TestBed } from '@angular/core/testing';
import {
  StorageMigrationService,
  STORAGE_VERSION_KEY,
  MIGRATION_MANIFEST_KEY,
  LEGACY_ATTEMPTS_KEY,
  LEGACY_SESSIONS_KEY,
  BACKUP_LEGACY_ATTEMPTS_KEY,
  BACKUP_LEGACY_SESSIONS_KEY,
  STAGING_ATTEMPTS_KEY,
  STAGING_SESSIONS_KEY,
  GUEST_ATTEMPTS_KEY,
  GUEST_SESSIONS_KEY,
  ID_MAP_KEY,
  CORRUPTED_ITEMS_KEY,
} from './storage-migration.service';
import { isValidUuidV4 } from '../utils/uuid.util';

describe('StorageMigrationService', () => {
  let service: StorageMigrationService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(StorageMigrationService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should handle clean install when no legacy data exists', () => {
    const result = service.migrate();

    expect(result.success).toBe(true);
    expect(result.status).toBe('clean_install');
    expect(localStorage.getItem(STORAGE_VERSION_KEY)).toBe('1');
    const manifest = JSON.parse(localStorage.getItem(MIGRATION_MANIFEST_KEY) || '{}');
    expect(manifest.status).toBe('completed');
    expect(manifest.attemptsCount).toBe(0);
  });

  it('should not re-run if already migrated', () => {
    service.migrate();
    const result = service.migrate();

    expect(result.success).toBe(true);
    expect(result.status).toBe('already_migrated');
  });

  it('should migrate legacy data preserving valid UUIDs and generating new UUIDs for legacy IDs', () => {
    const validUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const legacyNumericId = '1715000000000';
    const legacySessionId = 'session-123';

    const legacyAttempts = [
      {
        id: validUuid,
        patternId: 'pattern-a',
        userInput: 'I develop software',
        timestamp: '2026-09-07T10:00:00.000Z',
        isValid: true,
      },
      {
        id: legacyNumericId,
        patternId: 'pattern-b',
        userInput: 'I have experience in Angular',
        timestamp: '2026-09-07T11:00:00.000Z',
        isValid: true,
        sessionId: legacySessionId,
      },
    ];

    const legacySessions = [
      {
        id: legacySessionId,
        date: '2026-09-07',
        durationMinutes: 40,
        theme: 'Frontend Architecture',
      },
    ];

    localStorage.setItem(LEGACY_ATTEMPTS_KEY, JSON.stringify(legacyAttempts));
    localStorage.setItem(LEGACY_SESSIONS_KEY, JSON.stringify(legacySessions));

    const result = service.migrate();

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.migratedAttempts).toBe(2);
    expect(result.migratedSessions).toBe(1);

    expect(localStorage.getItem(BACKUP_LEGACY_ATTEMPTS_KEY)).toBe(JSON.stringify(legacyAttempts));
    expect(localStorage.getItem(BACKUP_LEGACY_SESSIONS_KEY)).toBe(JSON.stringify(legacySessions));

    const guestAttempts = JSON.parse(localStorage.getItem(GUEST_ATTEMPTS_KEY) || '[]');
    const guestSessions = JSON.parse(localStorage.getItem(GUEST_SESSIONS_KEY) || '[]');

    expect(guestAttempts.length).toBe(2);
    expect(guestSessions.length).toBe(1);

    expect(guestAttempts[0].id).toBe(validUuid);
    expect(isValidUuidV4(guestAttempts[1].id)).toBe(true);
    expect(guestAttempts[1].id).not.toBe(legacyNumericId);

    const newSessionId = guestSessions[0].id;
    expect(isValidUuidV4(newSessionId)).toBe(true);
    expect(newSessionId).not.toBe(legacySessionId);

    expect(guestAttempts[1].sessionId).toBe(newSessionId);

    const idMap = JSON.parse(localStorage.getItem(ID_MAP_KEY) || '{}');
    expect(idMap[legacyNumericId]).toBe(guestAttempts[1].id);
    expect(idMap[legacySessionId]).toBe(newSessionId);
  });

  it('should recover and clean up if a previous migration was interrupted during staging', () => {
    const legacyAttempts = [
      {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        patternId: 'pattern-a',
        userInput: 'I build software',
        timestamp: '2026-09-07T10:00:00.000Z',
        isValid: true,
      },
    ];

    localStorage.setItem(LEGACY_ATTEMPTS_KEY, JSON.stringify(legacyAttempts));
    localStorage.setItem(STAGING_ATTEMPTS_KEY, 'stale-corrupted-staging');
    localStorage.setItem(STAGING_SESSIONS_KEY, 'stale-corrupted-sessions');
    localStorage.setItem(
      MIGRATION_MANIFEST_KEY,
      JSON.stringify({
        version: 1,
        status: 'started',
        timestamp: '2026-09-07T09:00:00.000Z',
        attemptsCount: 1,
        sessionsCount: 0,
      })
    );

    const result = service.migrate();

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(localStorage.getItem(STAGING_ATTEMPTS_KEY)).toBeNull();
    expect(localStorage.getItem(STAGING_SESSIONS_KEY)).toBeNull();

    const guestAttempts = JSON.parse(localStorage.getItem(GUEST_ATTEMPTS_KEY) || '[]');
    expect(guestAttempts.length).toBe(1);
    expect(guestAttempts[0].id).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
  });

  it('should isolate corrupted JSON items and migrate remaining valid items', () => {
    const mixedAttempts = [
      {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        patternId: 'pattern-a',
        userInput: 'Valid attempt',
        timestamp: '2026-09-07T10:00:00.000Z',
        isValid: true,
      },
      null,
      'invalid-string-item',
    ];

    localStorage.setItem(LEGACY_ATTEMPTS_KEY, JSON.stringify(mixedAttempts));

    const result = service.migrate();

    expect(result.success).toBe(true);
    expect(result.migratedAttempts).toBe(1);
    expect(result.corruptedCount).toBe(2);

    const corrupted = JSON.parse(localStorage.getItem(CORRUPTED_ITEMS_KEY) || '[]');
    expect(corrupted.length).toBe(2);
  });

  it('should map legacy session ID in ProgressEvaluation and PracticeAttempt consistently', () => {
    const legacySessionId = 'legacy-sess-999';
    const legacySessions = [
      {
        id: legacySessionId,
        date: '2026-09-07',
        durationMinutes: 45,
        theme: 'Leadership',
        evaluation: {
          sessionId: legacySessionId,
          comprehension: 5,
          construction: 5,
          vocabulary: 4,
          fluency: 4,
          grammar: 5,
          pronunciation: 4,
          newWordsCount: 10,
          nextGoal: 'Executive summaries',
        },
      },
    ];

    const legacyAttempts = [
      {
        id: 'legacy-att-1',
        patternId: 'pattern-c',
        userInput: 'I led the migration',
        timestamp: '2026-09-07T12:00:00.000Z',
        isValid: true,
        sessionId: legacySessionId,
      },
    ];

    localStorage.setItem(LEGACY_SESSIONS_KEY, JSON.stringify(legacySessions));
    localStorage.setItem(LEGACY_ATTEMPTS_KEY, JSON.stringify(legacyAttempts));

    const result = service.migrate();
    expect(result.success).toBe(true);

    const guestSessions = JSON.parse(localStorage.getItem(GUEST_SESSIONS_KEY) || '[]');
    const guestAttempts = JSON.parse(localStorage.getItem(GUEST_ATTEMPTS_KEY) || '[]');

    const newSessionId = guestSessions[0].id;
    expect(isValidUuidV4(newSessionId)).toBe(true);
    expect(guestSessions[0].evaluation.sessionId).toBe(newSessionId);
    expect(guestAttempts[0].sessionId).toBe(newSessionId);
  });

  it('should not modify UUIDs or references when migration runs repeatedly', () => {
    const legacySessionId = 'legacy-sess-111';
    const legacySessions = [
      {
        id: legacySessionId,
        date: '2026-09-07',
        durationMinutes: 30,
        theme: 'Algorithms',
      },
    ];

    const legacyAttempts = [
      {
        id: 'legacy-att-222',
        patternId: 'pattern-a',
        userInput: 'I solve problems',
        timestamp: '2026-09-07T12:00:00.000Z',
        isValid: true,
        sessionId: legacySessionId,
      },
    ];

    localStorage.setItem(LEGACY_SESSIONS_KEY, JSON.stringify(legacySessions));
    localStorage.setItem(LEGACY_ATTEMPTS_KEY, JSON.stringify(legacyAttempts));

    service.migrate();

    const firstSessions = JSON.parse(localStorage.getItem(GUEST_SESSIONS_KEY) || '[]');
    const firstAttempts = JSON.parse(localStorage.getItem(GUEST_ATTEMPTS_KEY) || '[]');

    localStorage.removeItem(STORAGE_VERSION_KEY);
    localStorage.removeItem(MIGRATION_MANIFEST_KEY);

    service.migrate();

    const secondSessions = JSON.parse(localStorage.getItem(GUEST_SESSIONS_KEY) || '[]');
    const secondAttempts = JSON.parse(localStorage.getItem(GUEST_ATTEMPTS_KEY) || '[]');

    expect(secondSessions[0].id).toBe(firstSessions[0].id);
    expect(secondAttempts[0].id).toBe(firstAttempts[0].id);
    expect(secondAttempts[0].sessionId).toBe(firstSessions[0].id);
  });

  it('should keep legacy keys intact and not advance storage_version if writing fails with QuotaExceededError', () => {
    const legacyAttempts = [
      {
        id: 'legacy-1',
        patternId: 'pattern-a',
        userInput: 'Text',
        timestamp: '2026-09-07T10:00:00.000Z',
        isValid: true,
      },
    ];
    localStorage.setItem(LEGACY_ATTEMPTS_KEY, JSON.stringify(legacyAttempts));

    const originalSetItem = Storage.prototype.setItem;
    try {
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === GUEST_ATTEMPTS_KEY) {
          const quotaError = new Error('QuotaExceededError');
          quotaError.name = 'QuotaExceededError';
          throw quotaError;
        }
        return originalSetItem.call(this, key, value);
      };

      const result = service.migrate();

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(localStorage.getItem(STORAGE_VERSION_KEY)).toBeNull();
      expect(localStorage.getItem(LEGACY_ATTEMPTS_KEY)).toBe(JSON.stringify(legacyAttempts));
    } finally {
      Storage.prototype.setItem = originalSetItem;
    }
  });
});
