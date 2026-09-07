import { Injectable } from '@angular/core';
import { generateUuidV4, isValidUuidV4 } from '../utils/uuid.util';
import { MigrationManifest } from '../models/sync.model';
import { PracticeAttempt, SessionSummary, ProgressEvaluation } from '../models/session.model';

export const STORAGE_VERSION_KEY = 'ecp_storage_version';
export const MIGRATION_MANIFEST_KEY = 'ecp_migration_manifest';
export const ID_MAP_KEY = 'ecp_id_map';
export const LEGACY_ATTEMPTS_KEY = 'ecp_practice_attempts';
export const LEGACY_SESSIONS_KEY = 'ecp_sessions_history';
export const BACKUP_LEGACY_ATTEMPTS_KEY = 'ecp_backup_legacy_attempts';
export const BACKUP_LEGACY_SESSIONS_KEY = 'ecp_backup_legacy_sessions';
export const STAGING_ATTEMPTS_KEY = 'ecp_staging:attempts';
export const STAGING_SESSIONS_KEY = 'ecp_staging:sessions';
export const CORRUPTED_ITEMS_KEY = 'ecp_corrupted_items';
export const GUEST_ATTEMPTS_KEY = 'ecp_guest:attempts';
export const GUEST_SESSIONS_KEY = 'ecp_guest:sessions';

export interface MigrationResult {
  success: boolean;
  status: 'already_migrated' | 'clean_install' | 'completed' | 'failed';
  manifest: MigrationManifest | null;
  migratedAttempts: number;
  migratedSessions: number;
  corruptedCount: number;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class StorageMigrationService {
  migrate(): MigrationResult {
    try {
      const currentVersion = localStorage.getItem(STORAGE_VERSION_KEY);
      const rawManifest = localStorage.getItem(MIGRATION_MANIFEST_KEY);
      const manifest: MigrationManifest | null = rawManifest ? JSON.parse(rawManifest) : null;

      if (currentVersion === '1' && manifest?.status === 'completed') {
        return {
          success: true,
          status: 'already_migrated',
          manifest,
          migratedAttempts: manifest.attemptsCount,
          migratedSessions: manifest.sessionsCount,
          corruptedCount: 0,
        };
      }

      this.cleanupStaging();

      const rawLegacyAttempts =
        localStorage.getItem(LEGACY_ATTEMPTS_KEY) || localStorage.getItem(BACKUP_LEGACY_ATTEMPTS_KEY);
      const rawLegacySessions =
        localStorage.getItem(LEGACY_SESSIONS_KEY) || localStorage.getItem(BACKUP_LEGACY_SESSIONS_KEY);

      if (!rawLegacyAttempts && !rawLegacySessions) {
        const cleanManifest: MigrationManifest = {
          version: 1,
          status: 'completed',
          timestamp: new Date().toISOString(),
          attemptsCount: 0,
          sessionsCount: 0,
        };
        localStorage.setItem(STORAGE_VERSION_KEY, '1');
        localStorage.setItem(MIGRATION_MANIFEST_KEY, JSON.stringify(cleanManifest));
        return {
          success: true,
          status: 'clean_install',
          manifest: cleanManifest,
          migratedAttempts: 0,
          migratedSessions: 0,
          corruptedCount: 0,
        };
      }

      if (rawLegacyAttempts && !localStorage.getItem(BACKUP_LEGACY_ATTEMPTS_KEY)) {
        localStorage.setItem(BACKUP_LEGACY_ATTEMPTS_KEY, rawLegacyAttempts);
      }
      if (rawLegacySessions && !localStorage.getItem(BACKUP_LEGACY_SESSIONS_KEY)) {
        localStorage.setItem(BACKUP_LEGACY_SESSIONS_KEY, rawLegacySessions);
      }

      const corruptedList: unknown[] = [];
      const idMap: Record<string, string> = this.loadIdMap();

      const parsedLegacySessions = this.safeParseArray(rawLegacySessions, corruptedList);
      const parsedLegacyAttempts = this.safeParseArray(rawLegacyAttempts, corruptedList);

      const initialManifest: MigrationManifest = {
        version: 1,
        status: 'started',
        timestamp: new Date().toISOString(),
        attemptsCount: parsedLegacyAttempts.length,
        sessionsCount: parsedLegacySessions.length,
      };
      localStorage.setItem(MIGRATION_MANIFEST_KEY, JSON.stringify(initialManifest));

      const stagedSessions: SessionSummary[] = [];
      for (const item of parsedLegacySessions) {
        if (!item || typeof item !== 'object') {
          corruptedList.push(item);
          continue;
        }
        const candidate = item as Record<string, unknown>;
        const oldId = typeof candidate['id'] === 'string' ? candidate['id'] : '';
        const id = isValidUuidV4(oldId) ? oldId : (idMap[oldId] || generateUuidV4());
        if (oldId && oldId !== id) {
          idMap[oldId] = id;
        }

        const date = typeof candidate['date'] === 'string' ? candidate['date'] : new Date().toISOString().split('T')[0];
        const durationMinutes = typeof candidate['durationMinutes'] === 'number' ? candidate['durationMinutes'] : 35;
        const theme = typeof candidate['theme'] === 'string' ? candidate['theme'] : 'General Practice';
        const notes = typeof candidate['notes'] === 'string' ? candidate['notes'] : undefined;

        let evaluation: ProgressEvaluation | undefined = undefined;
        if (candidate['evaluation'] && typeof candidate['evaluation'] === 'object') {
          const evalCandidate = { ...(candidate['evaluation'] as Record<string, unknown>) };
          if (typeof evalCandidate['sessionId'] === 'string' && idMap[evalCandidate['sessionId']]) {
            evalCandidate['sessionId'] = idMap[evalCandidate['sessionId']];
          }
          evaluation = evalCandidate as unknown as ProgressEvaluation;
        }

        stagedSessions.push({
          id,
          date,
          durationMinutes,
          theme,
          notes,
          evaluation,
          syncStatus: 'pending',
        });
      }

      const stagedAttempts: PracticeAttempt[] = [];
      for (const item of parsedLegacyAttempts) {
        if (!item || typeof item !== 'object') {
          corruptedList.push(item);
          continue;
        }
        const candidate = item as Record<string, unknown>;
        const oldId = typeof candidate['id'] === 'string' ? candidate['id'] : '';
        const id = isValidUuidV4(oldId) ? oldId : (idMap[oldId] || generateUuidV4());
        if (oldId && oldId !== id) {
          idMap[oldId] = id;
        }

        const patternId = typeof candidate['patternId'] === 'string' ? candidate['patternId'] : 'pattern-a';
        const userInput = typeof candidate['userInput'] === 'string' ? candidate['userInput'] : '';
        const timestamp = typeof candidate['timestamp'] === 'string' ? candidate['timestamp'] : new Date().toISOString();
        const isValid = typeof candidate['isValid'] === 'boolean' ? candidate['isValid'] : true;
        const feedback = typeof candidate['feedback'] === 'string' ? candidate['feedback'] : undefined;

        let sessionId: string | null = null;
        if (typeof candidate['sessionId'] === 'string' && candidate['sessionId']) {
          const rawSessionId = candidate['sessionId'];
          sessionId = idMap[rawSessionId] || (isValidUuidV4(rawSessionId) ? rawSessionId : null);
        }

        stagedAttempts.push({
          id,
          patternId,
          userInput,
          timestamp,
          isValid,
          feedback,
          sessionId,
          syncStatus: 'pending',
        });
      }

      localStorage.setItem(STAGING_SESSIONS_KEY, JSON.stringify(stagedSessions));
      localStorage.setItem(STAGING_ATTEMPTS_KEY, JSON.stringify(stagedAttempts));
      localStorage.setItem(ID_MAP_KEY, JSON.stringify(idMap));
      if (corruptedList.length > 0) {
        localStorage.setItem(CORRUPTED_ITEMS_KEY, JSON.stringify(corruptedList));
      }

      const stagedManifest: MigrationManifest = {
        ...initialManifest,
        status: 'staged',
      };
      localStorage.setItem(MIGRATION_MANIFEST_KEY, JSON.stringify(stagedManifest));

      const isSessionsValid = stagedSessions.every((s) => isValidUuidV4(s.id));
      const isAttemptsValid = stagedAttempts.every((a) => isValidUuidV4(a.id));

      if (!isSessionsValid || !isAttemptsValid) {
        throw new Error('Integrity verification failed: invalid UUID generated during staging');
      }

      const verifiedManifest: MigrationManifest = {
        ...stagedManifest,
        status: 'verified',
      };
      localStorage.setItem(MIGRATION_MANIFEST_KEY, JSON.stringify(verifiedManifest));

      const existingGuestAttempts = this.safeParseArray(localStorage.getItem(GUEST_ATTEMPTS_KEY), []);
      const existingGuestSessions = this.safeParseArray(localStorage.getItem(GUEST_SESSIONS_KEY), []);

      const mergedAttempts = this.deduplicateById([...stagedAttempts, ...(existingGuestAttempts as PracticeAttempt[])]);
      const mergedSessions = this.deduplicateById([...stagedSessions, ...(existingGuestSessions as SessionSummary[])]);

      localStorage.setItem(GUEST_ATTEMPTS_KEY, JSON.stringify(mergedAttempts));
      localStorage.setItem(GUEST_SESSIONS_KEY, JSON.stringify(mergedSessions));

      this.cleanupStaging();

      const completedManifest: MigrationManifest = {
        ...verifiedManifest,
        status: 'completed',
        attemptsCount: stagedAttempts.length,
        sessionsCount: stagedSessions.length,
      };
      localStorage.setItem(STORAGE_VERSION_KEY, '1');
      localStorage.setItem(MIGRATION_MANIFEST_KEY, JSON.stringify(completedManifest));

      return {
        success: true,
        status: 'completed',
        manifest: completedManifest,
        migratedAttempts: stagedAttempts.length,
        migratedSessions: stagedSessions.length,
        corruptedCount: corruptedList.length,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Storage migration failed';
      this.cleanupStaging();
      const failedManifest: MigrationManifest = {
        version: 1,
        status: 'failed',
        timestamp: new Date().toISOString(),
        attemptsCount: 0,
        sessionsCount: 0,
        error: errorMessage,
      };
      localStorage.setItem(MIGRATION_MANIFEST_KEY, JSON.stringify(failedManifest));
      return {
        success: false,
        status: 'failed',
        manifest: failedManifest,
        migratedAttempts: 0,
        migratedSessions: 0,
        corruptedCount: 0,
        error: errorMessage,
      };
    }
  }

  private safeParseArray(raw: string | null, corrupted: unknown[]): unknown[] {
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      corrupted.push(parsed);
      return [];
    } catch {
      corrupted.push(raw);
      return [];
    }
  }

  private loadIdMap(): Record<string, string> {
    try {
      const raw = localStorage.getItem(ID_MAP_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private cleanupStaging(): void {
    localStorage.removeItem(STAGING_ATTEMPTS_KEY);
    localStorage.removeItem(STAGING_SESSIONS_KEY);
  }

  private deduplicateById<T extends { id: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const item of items) {
      if (item && item.id && !seen.has(item.id)) {
        seen.add(item.id);
        result.push(item);
      }
    }
    return result;
  }
}
