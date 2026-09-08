import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { SyncQueueService } from './sync-queue.service';
import { RemoteSyncService } from './remote-sync.service';
import { PracticeAttempt, ProgressEvaluation, SessionSummary } from '../models/session.model';
import { getStorageNamespace, SyncEntityType, SyncQueueItem } from '../models/sync.model';
import {
  ClaimCheckpoint,
  ClaimVerificationReceipt,
  DurableClaimSnapshot,
  GuestClaimManifest,
  GuestClaimSummary,
  UserClaimDecision,
  VerificationStatus,
} from '../models/guest-claim.model';
import {
  areEntitiesSemanticallyEqual,
  computeEntityFingerprint,
  computeGuestDatasetFingerprint,
  makeReceiptKey,
} from '../utils/claim-canonical.util';
import { generateUuidV4 } from '../utils/uuid.util';
import { GUEST_STORAGE_LOCK, withStorageLock } from '../utils/storage-lock.util';

export const GUEST_CLAIM_MANIFEST_KEY_PREFIX = 'ecp_claim_manifest_';
export const GUEST_CLAIM_DECISION_KEY_PREFIX = 'ecp_claim_decision_';
export const GUEST_CLAIM_POSTPONED_KEY_PREFIX = 'ecp_claim_postponed_';

@Injectable({
  providedIn: 'root',
})
export class GuestClaimService {
  private supabaseService = inject(SupabaseService);
  private queueService = inject(SyncQueueService);
  private remoteSync = inject(RemoteSyncService);

  readonly isClaimPromptVisible = signal<boolean>(false);
  readonly activeCheckpoint = signal<ClaimCheckpoint | null>(null);
  readonly isProcessing = signal<boolean>(false);
  readonly claimError = signal<string | null>(null);
  readonly currentManifest = signal<GuestClaimManifest | null>(null);

  private claimGeneration = 0;
  private activeUserId: string | null = null;

  constructor() {
    effect(() => {
      const user = this.supabaseService.currentUser();
      const isInit = this.supabaseService.isInitialized();

      if (isInit && user) {
        if (this.activeUserId !== user.id) {
          this.activeUserId = user.id;
          void this.handleUserAuthenticated(user.id);
        }
      } else if (isInit && !user) {
        if (this.activeUserId !== null) {
          this.handleUserSignedOut();
        }
      }
    });
  }

  get currentUserId(): string | null {
    return this.activeUserId;
  }

  getGuestSummary(): GuestClaimSummary {
    const sessions = this.loadGuestSessions();
    const attempts = this.loadGuestAttempts();

    const sessionIds = new Set(sessions.map((s) => s.id));
    let orphanCount = 0;
    for (const attempt of attempts) {
      if (attempt.sessionId && !sessionIds.has(attempt.sessionId)) {
        orphanCount++;
      }
    }

    let evaluationsCount = 0;
    for (const session of sessions) {
      if (session.evaluation) {
        evaluationsCount++;
      }
    }

    const fingerprint = computeGuestDatasetFingerprint(sessions, attempts);

    return {
      sessionsCount: sessions.length,
      attemptsCount: attempts.length,
      evaluationsCount,
      fingerprint,
      hasOrphans: orphanCount > 0,
      orphanCount,
    };
  }

  async handleUserAuthenticated(userId: string): Promise<void> {
    const opGen = ++this.claimGeneration;
    this.activeUserId = userId;
    this.claimError.set(null);

    const existingManifest = this.loadManifest(userId);
    if (existingManifest && existingManifest.checkpoint !== 'COMPLETED') {
      this.currentManifest.set(existingManifest);
      this.activeCheckpoint.set(existingManifest.checkpoint);
      await this.reconcile(userId, opGen);
      return;
    }

    const summary = this.getGuestSummary();
    if (summary.sessionsCount === 0 && summary.attemptsCount === 0) {
      this.isClaimPromptVisible.set(false);
      return;
    }

    if (this.isPostponedForSession(userId, summary.fingerprint)) {
      this.isClaimPromptVisible.set(false);
      return;
    }

    if (this.isSeparatedForUser(userId, summary.fingerprint)) {
      this.isClaimPromptVisible.set(false);
      return;
    }

    if (this.claimGeneration === opGen && this.activeUserId === userId) {
      this.isClaimPromptVisible.set(true);
    }
  }

  handleUserSignedOut(): void {
    ++this.claimGeneration;
    this.activeUserId = null;
    this.isClaimPromptVisible.set(false);
    this.isProcessing.set(false);
    this.activeCheckpoint.set(null);
    this.claimError.set(null);
    this.currentManifest.set(null);
  }

  postpone(): void {
    if (!this.activeUserId) {
      this.isClaimPromptVisible.set(false);
      return;
    }
    const summary = this.getGuestSummary();
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(`${GUEST_CLAIM_POSTPONED_KEY_PREFIX}${this.activeUserId}`, summary.fingerprint);
      } catch {}
    }
    this.isClaimPromptVisible.set(false);
  }

  keepSeparate(): void {
    if (!this.activeUserId) {
      this.isClaimPromptVisible.set(false);
      return;
    }
    const summary = this.getGuestSummary();
    const decision: UserClaimDecision = {
      userId: this.activeUserId,
      decision: 'separate',
      guestFingerprint: summary.fingerprint,
      decidedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(`${GUEST_CLAIM_DECISION_KEY_PREFIX}${this.activeUserId}`, JSON.stringify(decision));
    } catch {}
    this.isClaimPromptVisible.set(false);
  }

  async claim(): Promise<boolean> {
    const userId = this.activeUserId || this.supabaseService.currentUser()?.id;
    if (!userId) {
      return false;
    }
    this.activeUserId = userId;

    const opGen = ++this.claimGeneration;
    this.isProcessing.set(true);
    this.claimError.set(null);

    const result = await this.withClaimLock(userId, async () => {
      try {
        return await this.executeClaimPipeline(userId, opGen);
      } catch (err: unknown) {
        if (this.claimGeneration === opGen && this.activeUserId === userId) {
          const msg = err instanceof Error ? err.message : 'Error processing guest data claim';
          this.claimError.set(msg);
          this.activeCheckpoint.set('FAILED');
        }
        return false;
      } finally {
        if (this.claimGeneration === opGen && this.activeUserId === userId) {
          this.isProcessing.set(false);
        }
      }
    });

    return result ?? false;
  }

  private async withClaimLock<T>(userId: string, task: () => Promise<T>): Promise<T | null> {
    if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks?.request) {
      try {
        return await navigator.locks.request(`ecp_claim_${userId}`, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            return null;
          }
          return await task();
        });
      } catch {
        return await task();
      }
    }
    return await task();
  }

  private async executeClaimPipeline(userId: string, opGen: number): Promise<boolean> {
    let manifest = this.loadManifest(userId);

    if (!manifest || manifest.checkpoint === 'COMPLETED' || manifest.checkpoint === 'FAILED') {
      const rawSessions = this.loadGuestSessions();
      const rawAttempts = this.loadGuestAttempts();
      const rawQueue = this.queueService.getQueue(null);

      const snapshot: DurableClaimSnapshot = {
        sessions: rawSessions,
        attempts: rawAttempts,
        queueItems: rawQueue,
      };

      const sourceFingerprint = computeGuestDatasetFingerprint(rawSessions, rawAttempts);

      manifest = {
        claimId: generateUuidV4(),
        userId,
        checkpoint: 'SNAPSHOT_CAPTURED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceFingerprint,
        snapshot,
        receipts: {},
      };

      this.saveManifest(manifest);
      this.currentManifest.set(manifest);
      this.activeCheckpoint.set('SNAPSHOT_CAPTURED');
    }

    if (this.shouldAbort(opGen, userId)) {
      return false;
    }

    if (manifest.checkpoint === 'SNAPSHOT_CAPTURED') {
      this.mergeLocalSnapshot(manifest, userId);
      manifest.checkpoint = 'LOCAL_MERGED';
      manifest.updatedAt = new Date().toISOString();
      this.saveManifest(manifest);
      this.currentManifest.set(manifest);
      this.activeCheckpoint.set('LOCAL_MERGED');
    }

    if (this.shouldAbort(opGen, userId)) {
      return false;
    }

    if (manifest.checkpoint === 'LOCAL_MERGED') {
      this.enqueueLocalSnapshot(manifest, userId);
      manifest.checkpoint = 'ENQUEUED';
      manifest.updatedAt = new Date().toISOString();
      this.saveManifest(manifest);
      this.currentManifest.set(manifest);
      this.activeCheckpoint.set('ENQUEUED');
    }

    if (this.shouldAbort(opGen, userId)) {
      return false;
    }

    if (manifest.checkpoint === 'ENQUEUED' || manifest.checkpoint === 'PARTIALLY_VERIFIED') {
      await this.remoteSync.requestSync();

      if (this.shouldAbort(opGen, userId)) {
        return false;
      }

      const allVerified = await this.verifyRemoteReceipts(manifest, userId, opGen);
      manifest.updatedAt = new Date().toISOString();

      if (allVerified) {
        manifest.checkpoint = 'REMOTE_VERIFIED';
      } else {
        manifest.checkpoint = 'PARTIALLY_VERIFIED';
      }

      this.saveManifest(manifest);
      this.currentManifest.set(manifest);
      this.activeCheckpoint.set(manifest.checkpoint);
    }

    if (this.shouldAbort(opGen, userId)) {
      return false;
    }

    if (manifest.checkpoint === 'REMOTE_VERIFIED' || manifest.checkpoint === 'PARTIALLY_VERIFIED') {
      await this.executeSafePurge(manifest, userId);
      manifest.updatedAt = new Date().toISOString();

      const allEntitiesFullyResolved = this.checkIfAllSnapshotEntitiesPurged(manifest);
      if (allEntitiesFullyResolved) {
        manifest.checkpoint = 'COMPLETED';
        this.isClaimPromptVisible.set(false);
      }

      this.saveManifest(manifest);
      this.currentManifest.set(manifest);
      this.activeCheckpoint.set(manifest.checkpoint);

      return allEntitiesFullyResolved;
    }

    return manifest.checkpoint === 'COMPLETED';
  }

  async reconcile(userId: string, opGen = ++this.claimGeneration): Promise<boolean> {
    this.activeUserId = userId;
    const manifest = this.loadManifest(userId);
    if (!manifest) {
      return false;
    }
    this.isProcessing.set(true);
    try {
      return await this.executeClaimPipeline(userId, opGen);
    } catch (err: unknown) {
      if (this.claimGeneration === opGen && this.activeUserId === userId) {
        const msg = err instanceof Error ? err.message : 'Error reconciling claim';
        this.claimError.set(msg);
      }
      return false;
    } finally {
      if (this.claimGeneration === opGen && this.activeUserId === userId) {
        this.isProcessing.set(false);
      }
    }
  }

  private mergeLocalSnapshot(manifest: GuestClaimManifest, userId: string): void {
    const userNamespace = getStorageNamespace(userId);
    const existingSessions = this.loadSessionsFromKey(userNamespace.sessionsKey);
    const existingAttempts = this.loadAttemptsFromKey(userNamespace.attemptsKey);

    const destSessionMap = new Map<string, SessionSummary>(existingSessions.map((s) => [s.id, s]));
    const destAttemptMap = new Map<string, PracticeAttempt>(existingAttempts.map((a) => [a.id, a]));

    const snapshotSessionIds = new Set(manifest.snapshot.sessions.map((s) => s.id));
    const allKnownSessionIds = new Set<string>([...snapshotSessionIds, ...destSessionMap.keys()]);

    const updatedSessions = [...existingSessions];
    for (const guestSession of manifest.snapshot.sessions) {
      const existing = destSessionMap.get(guestSession.id);
      if (!existing) {
        updatedSessions.push({
          ...guestSession,
          syncStatus: 'pending',
          claimedBy: userId,
          claimedAt: new Date().toISOString(),
        });
        destSessionMap.set(guestSession.id, guestSession);
      } else {
        const isIdentical = areEntitiesSemanticallyEqual('session', guestSession, existing);
        if (!isIdentical) {
          manifest.receipts[makeReceiptKey('session', guestSession.id)] = {
            receiptId: generateUuidV4(),
            claimId: manifest.claimId,
            userId,
            entityType: 'session',
            entityId: guestSession.id,
            expectedFingerprint: computeEntityFingerprint('session', guestSession),
            verifiedAt: new Date().toISOString(),
            status: 'remote_conflict',
            errorMessage: 'Local conflict with existing user session',
          };
        }
      }
    }

    const updatedAttempts = [...existingAttempts];
    for (const guestAttempt of manifest.snapshot.attempts) {
      if (guestAttempt.sessionId && !allKnownSessionIds.has(guestAttempt.sessionId)) {
        manifest.receipts[makeReceiptKey('practice_attempt', guestAttempt.id)] = {
          receiptId: generateUuidV4(),
          claimId: manifest.claimId,
          userId,
          entityType: 'practice_attempt',
          entityId: guestAttempt.id,
          expectedFingerprint: computeEntityFingerprint('practice_attempt', guestAttempt),
          verifiedAt: new Date().toISOString(),
          status: 'error',
          errorMessage: 'Orphan foreign key: sessionId not resolvable in destination',
        };
        continue;
      }

      const existing = destAttemptMap.get(guestAttempt.id);
      if (!existing) {
        updatedAttempts.push({
          ...guestAttempt,
          syncStatus: 'pending',
          claimedBy: userId,
          claimedAt: new Date().toISOString(),
        });
        destAttemptMap.set(guestAttempt.id, guestAttempt);
      } else {
        const isIdentical = areEntitiesSemanticallyEqual('practice_attempt', guestAttempt, existing);
        if (!isIdentical) {
          manifest.receipts[makeReceiptKey('practice_attempt', guestAttempt.id)] = {
            receiptId: generateUuidV4(),
            claimId: manifest.claimId,
            userId,
            entityType: 'practice_attempt',
            entityId: guestAttempt.id,
            expectedFingerprint: computeEntityFingerprint('practice_attempt', guestAttempt),
            verifiedAt: new Date().toISOString(),
            status: 'remote_conflict',
            errorMessage: 'Local conflict with existing user attempt',
          };
        }
      }
    }

    this.saveSessionsToKey(userNamespace.sessionsKey, updatedSessions);
    this.saveAttemptsToKey(userNamespace.attemptsKey, updatedAttempts);
  }

  private enqueueLocalSnapshot(manifest: GuestClaimManifest, userId: string): void {
    for (const session of manifest.snapshot.sessions) {
      const receiptKey = makeReceiptKey('session', session.id);
      if (manifest.receipts[receiptKey]?.status === 'remote_conflict') {
        continue;
      }

      this.queueService.enqueue(userId, 'session', {
        ...session,
        syncStatus: 'pending',
        claimedBy: userId,
        claimedAt: new Date().toISOString(),
      });

      if (session.evaluation) {
        this.queueService.enqueue(userId, 'progress_evaluation', {
          id: generateUuidV4(),
          sessionId: session.id,
          ...session.evaluation,
        });
      }
    }

    for (const attempt of manifest.snapshot.attempts) {
      const receiptKey = makeReceiptKey('practice_attempt', attempt.id);
      const existingReceipt = manifest.receipts[receiptKey];
      if (existingReceipt && (existingReceipt.status === 'remote_conflict' || existingReceipt.status === 'error')) {
        continue;
      }

      this.queueService.enqueue(userId, 'practice_attempt', {
        ...attempt,
        syncStatus: 'pending',
        claimedBy: userId,
        claimedAt: new Date().toISOString(),
      });
    }
  }

  private async verifyRemoteReceipts(
    manifest: GuestClaimManifest,
    userId: string,
    opGen: number
  ): Promise<boolean> {
    const client = this.supabaseService.client;
    if (!client) {
      return false;
    }

    let allVerified = true;

    for (const session of manifest.snapshot.sessions) {
      if (this.shouldAbort(opGen, userId)) {
        return false;
      }
      const receiptKey = makeReceiptKey('session', session.id);
      const expectedFingerprint = computeEntityFingerprint('session', session);

      const { data, error } = await client
        .from('sessions')
        .select('*')
        .eq('id', session.id)
        .maybeSingle();

      if (error) {
        allVerified = false;
        manifest.receipts[receiptKey] = {
          receiptId: manifest.receipts[receiptKey]?.receiptId || generateUuidV4(),
          claimId: manifest.claimId,
          userId,
          entityType: 'session',
          entityId: session.id,
          expectedFingerprint,
          verifiedAt: new Date().toISOString(),
          status: 'error',
          errorMessage: error.message,
        };
        continue;
      }

      if (!data) {
        allVerified = false;
        manifest.receipts[receiptKey] = {
          receiptId: manifest.receipts[receiptKey]?.receiptId || generateUuidV4(),
          claimId: manifest.claimId,
          userId,
          entityType: 'session',
          entityId: session.id,
          expectedFingerprint,
          verifiedAt: new Date().toISOString(),
          status: 'not_found',
          errorMessage: 'Remote row not found in sessions',
        };
        continue;
      }

      const remoteUserId = data.user_id;
      const remoteMatchesContent =
        data.id === session.id &&
        data.user_id === userId &&
        data.session_date === session.date &&
        data.focus_theme === session.theme &&
        data.duration_minutes === session.durationMinutes;

      const receiptStatus: VerificationStatus =
        remoteUserId !== userId
          ? 'unauthorized'
          : remoteMatchesContent
          ? 'verified'
          : 'remote_conflict';

      if (receiptStatus !== 'verified') {
        allVerified = false;
      }

      manifest.receipts[receiptKey] = {
        receiptId: manifest.receipts[receiptKey]?.receiptId || generateUuidV4(),
        claimId: manifest.claimId,
        userId,
        entityType: 'session',
        entityId: session.id,
        expectedFingerprint,
        remoteRowId: data.id,
        remoteUserId: data.user_id,
        verifiedAt: new Date().toISOString(),
        status: receiptStatus,
      };

      if (session.evaluation) {
        const evalReceiptKey = makeReceiptKey('progress_evaluation', session.id);
        const expectedEvalFingerprint = computeEntityFingerprint('progress_evaluation', session.evaluation);

        const { data: evalData, error: evalError } = await client
          .from('progress_evaluations')
          .select('*')
          .eq('session_id', session.id)
          .maybeSingle();

        if (evalError) {
          allVerified = false;
          manifest.receipts[evalReceiptKey] = {
            receiptId: manifest.receipts[evalReceiptKey]?.receiptId || generateUuidV4(),
            claimId: manifest.claimId,
            userId,
            entityType: 'progress_evaluation',
            entityId: session.id,
            expectedFingerprint: expectedEvalFingerprint,
            verifiedAt: new Date().toISOString(),
            status: 'error',
            errorMessage: evalError.message,
          };
          continue;
        }

        if (!evalData) {
          allVerified = false;
          manifest.receipts[evalReceiptKey] = {
            receiptId: manifest.receipts[evalReceiptKey]?.receiptId || generateUuidV4(),
            claimId: manifest.claimId,
            userId,
            entityType: 'progress_evaluation',
            entityId: session.id,
            expectedFingerprint: expectedEvalFingerprint,
            verifiedAt: new Date().toISOString(),
            status: 'not_found',
            errorMessage: 'Remote evaluation not found',
          };
          continue;
        }

        const evalMatches =
          evalData.session_id === session.id &&
          evalData.user_id === userId &&
          evalData.comprehension_score === session.evaluation.comprehension &&
          evalData.fluency_score === session.evaluation.fluency;

        const evalStatus: VerificationStatus =
          evalData.user_id !== userId
            ? 'unauthorized'
            : evalMatches
            ? 'verified'
            : 'remote_conflict';

        if (evalStatus !== 'verified') {
          allVerified = false;
        }

        manifest.receipts[evalReceiptKey] = {
          receiptId: manifest.receipts[evalReceiptKey]?.receiptId || generateUuidV4(),
          claimId: manifest.claimId,
          userId,
          entityType: 'progress_evaluation',
          entityId: session.id,
          expectedFingerprint: expectedEvalFingerprint,
          remoteRowId: evalData.session_id,
          remoteUserId: evalData.user_id,
          verifiedAt: new Date().toISOString(),
          status: evalStatus,
        };
      }
    }

    for (const attempt of manifest.snapshot.attempts) {
      if (this.shouldAbort(opGen, userId)) {
        return false;
      }
      const receiptKey = makeReceiptKey('practice_attempt', attempt.id);
      const expectedFingerprint = computeEntityFingerprint('practice_attempt', attempt);

      if (manifest.receipts[receiptKey]?.status === 'error') {
        allVerified = false;
        continue;
      }

      const { data, error } = await client
        .from('practice_attempts')
        .select('*')
        .eq('id', attempt.id)
        .maybeSingle();

      if (error) {
        allVerified = false;
        manifest.receipts[receiptKey] = {
          receiptId: manifest.receipts[receiptKey]?.receiptId || generateUuidV4(),
          claimId: manifest.claimId,
          userId,
          entityType: 'practice_attempt',
          entityId: attempt.id,
          expectedFingerprint,
          verifiedAt: new Date().toISOString(),
          status: 'error',
          errorMessage: error.message,
        };
        continue;
      }

      if (!data) {
        allVerified = false;
        manifest.receipts[receiptKey] = {
          receiptId: manifest.receipts[receiptKey]?.receiptId || generateUuidV4(),
          claimId: manifest.claimId,
          userId,
          entityType: 'practice_attempt',
          entityId: attempt.id,
          expectedFingerprint,
          verifiedAt: new Date().toISOString(),
          status: 'not_found',
          errorMessage: 'Remote row not found in practice_attempts',
        };
        continue;
      }

      const remoteMatchesContent =
        data.id === attempt.id &&
        data.user_id === userId &&
        data.pattern_id === attempt.patternId &&
        data.user_input === attempt.userInput;

      const receiptStatus: VerificationStatus =
        data.user_id !== userId
          ? 'unauthorized'
          : remoteMatchesContent
          ? 'verified'
          : 'remote_conflict';

      if (receiptStatus !== 'verified') {
        allVerified = false;
      }

      manifest.receipts[receiptKey] = {
        receiptId: manifest.receipts[receiptKey]?.receiptId || generateUuidV4(),
        claimId: manifest.claimId,
        userId,
        entityType: 'practice_attempt',
        entityId: attempt.id,
        expectedFingerprint,
        remoteRowId: data.id,
        remoteUserId: data.user_id,
        verifiedAt: new Date().toISOString(),
        status: receiptStatus,
      };
    }

    return allVerified;
  }

  private async executeSafePurge(manifest: GuestClaimManifest, userId: string): Promise<void> {
    await withStorageLock(GUEST_STORAGE_LOCK, async () => {
      if (this.activeUserId !== userId) {
        return;
      }

      const currentGuestSessions = this.loadGuestSessions();
      const currentGuestAttempts = this.loadGuestAttempts();

      const snapshotSessionMap = new Map(manifest.snapshot.sessions.map((s) => [s.id, s]));
      const snapshotAttemptMap = new Map(manifest.snapshot.attempts.map((a) => [a.id, a]));

      const verifiedAttemptIdsToPurge = new Set<string>();
      for (const currentAttempt of currentGuestAttempts) {
        const snapshotAttempt = snapshotAttemptMap.get(currentAttempt.id);
        if (!snapshotAttempt) {
          continue;
        }

        const isContentIdentical = areEntitiesSemanticallyEqual('practice_attempt', currentAttempt, snapshotAttempt);
        if (!isContentIdentical) {
          continue;
        }

        const receipt = manifest.receipts[makeReceiptKey('practice_attempt', currentAttempt.id)];
        if (!receipt || receipt.status !== 'verified' || receipt.userId !== userId) {
          continue;
        }

        if (currentAttempt.sessionId) {
          const sessionReceipt = manifest.receipts[makeReceiptKey('session', currentAttempt.sessionId)];
          if (!sessionReceipt || sessionReceipt.status !== 'verified' || sessionReceipt.userId !== userId) {
            continue;
          }
        }

        verifiedAttemptIdsToPurge.add(currentAttempt.id);
      }

      const verifiedSessionIdsToPurge = new Set<string>();
      for (const currentSession of currentGuestSessions) {
        const snapshotSession = snapshotSessionMap.get(currentSession.id);
        if (!snapshotSession) {
          continue;
        }

        const isContentIdentical = areEntitiesSemanticallyEqual('session', currentSession, snapshotSession);
        if (!isContentIdentical) {
          continue;
        }

        const sessionReceipt = manifest.receipts[makeReceiptKey('session', currentSession.id)];
        if (!sessionReceipt || sessionReceipt.status !== 'verified' || sessionReceipt.userId !== userId) {
          continue;
        }

        if (currentSession.evaluation) {
          const evalReceipt = manifest.receipts[makeReceiptKey('progress_evaluation', currentSession.id)];
          if (!evalReceipt || evalReceipt.status !== 'verified' || evalReceipt.userId !== userId) {
            continue;
          }
        }

        const hasUnresolvedChildAttempts = currentGuestAttempts.some((att) => {
          if (att.sessionId === currentSession.id) {
            return !verifiedAttemptIdsToPurge.has(att.id);
          }
          return false;
        });

        if (hasUnresolvedChildAttempts) {
          continue;
        }

        verifiedSessionIdsToPurge.add(currentSession.id);
      }

      const freshGuestSessions = this.loadGuestSessions();
      const remainingSessions = freshGuestSessions.filter((s) => {
        if (!verifiedSessionIdsToPurge.has(s.id)) {
          return true;
        }
        const snapshotSession = snapshotSessionMap.get(s.id);
        if (!snapshotSession || !areEntitiesSemanticallyEqual('session', s, snapshotSession)) {
          return true;
        }
        return false;
      });

      const freshGuestAttempts = this.loadGuestAttempts();
      const remainingAttempts = freshGuestAttempts.filter((a) => {
        if (!verifiedAttemptIdsToPurge.has(a.id)) {
          return true;
        }
        const snapshotAttempt = snapshotAttemptMap.get(a.id);
        if (!snapshotAttempt || !areEntitiesSemanticallyEqual('practice_attempt', a, snapshotAttempt)) {
          return true;
        }
        return false;
      });

      this.saveGuestSessions(remainingSessions);
      this.saveGuestAttempts(remainingAttempts);

      const guestQueue = this.queueService.getQueue(null);
      for (const item of guestQueue) {
        let isItemVerified = false;
        if (item.entityType === 'session' && verifiedSessionIdsToPurge.has(item.id)) {
          const snapSession = snapshotSessionMap.get(item.id);
          if (snapSession && areEntitiesSemanticallyEqual('session', item.payload, snapSession)) {
            isItemVerified = true;
          }
        } else if (item.entityType === 'practice_attempt' && verifiedAttemptIdsToPurge.has(item.id)) {
          const snapAttempt = snapshotAttemptMap.get(item.id);
          if (snapAttempt && areEntitiesSemanticallyEqual('practice_attempt', item.payload, snapAttempt)) {
            isItemVerified = true;
          }
        } else if (item.entityType === 'progress_evaluation') {
          const payload = item.payload as ProgressEvaluation & { sessionId?: string };
          if (payload?.sessionId && verifiedSessionIdsToPurge.has(payload.sessionId)) {
            isItemVerified = true;
          }
        }

        if (isItemVerified) {
          this.queueService.removeItem(null, item.id);
        }
      }
    });
  }

  private checkIfAllSnapshotEntitiesPurged(manifest: GuestClaimManifest): boolean {
    const currentSessions = this.loadGuestSessions();
    const currentAttempts = this.loadGuestAttempts();

    const snapshotSessionIds = new Set(manifest.snapshot.sessions.map((s) => s.id));
    const snapshotAttemptIds = new Set(manifest.snapshot.attempts.map((a) => a.id));

    const remainingSnapshotSessions = currentSessions.some((s) => snapshotSessionIds.has(s.id));
    const remainingSnapshotAttempts = currentAttempts.some((a) => snapshotAttemptIds.has(a.id));

    return !remainingSnapshotSessions && !remainingSnapshotAttempts;
  }

  private shouldAbort(opGen: number, userId: string): boolean {
    return this.claimGeneration !== opGen || this.activeUserId !== userId;
  }

  private isPostponedForSession(userId: string, fingerprint: string): boolean {
    if (typeof sessionStorage === 'undefined') {
      return false;
    }
    try {
      const stored = sessionStorage.getItem(`${GUEST_CLAIM_POSTPONED_KEY_PREFIX}${userId}`);
      return stored === fingerprint;
    } catch {
      return false;
    }
  }

  private isSeparatedForUser(userId: string, fingerprint: string): boolean {
    try {
      const raw = localStorage.getItem(`${GUEST_CLAIM_DECISION_KEY_PREFIX}${userId}`);
      if (!raw) {
        return false;
      }
      const parsed: UserClaimDecision = JSON.parse(raw);
      return parsed.decision === 'separate' && parsed.guestFingerprint === fingerprint;
    } catch {
      return false;
    }
  }

  private loadManifest(userId: string): GuestClaimManifest | null {
    try {
      const raw = localStorage.getItem(`${GUEST_CLAIM_MANIFEST_KEY_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private saveManifest(manifest: GuestClaimManifest): void {
    try {
      localStorage.setItem(`${GUEST_CLAIM_MANIFEST_KEY_PREFIX}${manifest.userId}`, JSON.stringify(manifest));
    } catch {}
  }

  private loadGuestSessions(): SessionSummary[] {
    const namespace = getStorageNamespace(null);
    return this.loadSessionsFromKey(namespace.sessionsKey);
  }

  private loadGuestAttempts(): PracticeAttempt[] {
    const namespace = getStorageNamespace(null);
    return this.loadAttemptsFromKey(namespace.attemptsKey);
  }

  private saveGuestSessions(sessions: SessionSummary[]): void {
    const namespace = getStorageNamespace(null);
    this.saveSessionsToKey(namespace.sessionsKey, sessions);
  }

  private saveGuestAttempts(attempts: PracticeAttempt[]): void {
    const namespace = getStorageNamespace(null);
    this.saveAttemptsToKey(namespace.attemptsKey, attempts);
  }

  private loadSessionsFromKey(key: string): SessionSummary[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private loadAttemptsFromKey(key: string): PracticeAttempt[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveSessionsToKey(key: string, sessions: SessionSummary[]): void {
    try {
      localStorage.setItem(key, JSON.stringify(sessions));
    } catch {}
  }

  private saveAttemptsToKey(key: string, attempts: PracticeAttempt[]): void {
    try {
      localStorage.setItem(key, JSON.stringify(attempts));
    } catch {}
  }
}
