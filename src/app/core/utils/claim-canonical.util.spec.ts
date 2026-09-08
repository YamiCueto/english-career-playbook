import { describe, it, expect } from 'vitest';
import {
  canonicalizeEvaluation,
  canonicalizeSession,
  canonicalizeAttempt,
  computeEntityFingerprint,
  areEntitiesSemanticallyEqual,
  computeGuestDatasetFingerprint,
  makeReceiptKey,
} from './claim-canonical.util';
import { SessionSummary, PracticeAttempt, ProgressEvaluation } from '../models/session.model';

describe('claim-canonical.util', () => {
  const sampleEval: ProgressEvaluation = {
    comprehension: 4,
    construction: 3,
    vocabulary: 5,
    fluency: 4,
    grammar: 3,
    pronunciation: 4,
    newWordsCount: 2,
    nextGoal: 'Master inversion patterns',
  };

  const sampleSession: SessionSummary = {
    id: '11111111-aaaa-4111-8111-111111111111',
    date: '2026-09-07',
    durationMinutes: 45,
    theme: 'Leadership sync',
    notes: 'Covered objections',
    evaluation: sampleEval,
    syncStatus: 'pending',
    claimedBy: 'user-1',
    claimedAt: '2026-09-07T12:00:00Z',
  };

  const sampleAttempt: PracticeAttempt = {
    id: '22222222-aaaa-4222-8222-222222222222',
    patternId: 'pattern-1',
    userInput: 'I propose we align on the deliverables first.',
    isValid: true,
    feedback: 'valid',
    sessionId: '11111111-aaaa-4111-8111-111111111111',
    timestamp: '2026-09-07T10:00:00Z',
    syncStatus: 'pending',
    claimedBy: 'user-1',
    claimedAt: '2026-09-07T12:00:00Z',
  };

  it('canonicalizes session excluding local sync metadata', () => {
    const sessionModifiedSync: SessionSummary = {
      ...sampleSession,
      syncStatus: 'synced',
      claimedBy: 'different-user',
      claimedAt: '2026-09-08T00:00:00Z',
    };
    expect(canonicalizeSession(sampleSession)).toBe(canonicalizeSession(sessionModifiedSync));
    expect(areEntitiesSemanticallyEqual('session', sampleSession, sessionModifiedSync)).toBe(true);
  });

  it('detects domain changes in session', () => {
    const sessionDifferentNotes: SessionSummary = {
      ...sampleSession,
      notes: 'Different notes',
    };
    expect(areEntitiesSemanticallyEqual('session', sampleSession, sessionDifferentNotes)).toBe(false);
  });

  it('canonicalizes attempt excluding local sync metadata', () => {
    const attemptModifiedSync: PracticeAttempt = {
      ...sampleAttempt,
      syncStatus: 'conflict',
      claimedBy: null,
      claimedAt: null,
    };
    expect(canonicalizeAttempt(sampleAttempt)).toBe(canonicalizeAttempt(attemptModifiedSync));
    expect(areEntitiesSemanticallyEqual('practice_attempt', sampleAttempt, attemptModifiedSync)).toBe(true);
  });

  it('detects domain changes in attempt', () => {
    const attemptDifferentInput: PracticeAttempt = {
      ...sampleAttempt,
      userInput: 'Slightly different sentence input.',
    };
    expect(areEntitiesSemanticallyEqual('practice_attempt', sampleAttempt, attemptDifferentInput)).toBe(false);
  });

  it('handles null evaluations gracefully', () => {
    expect(canonicalizeEvaluation(null)).toBe('null');
    expect(computeEntityFingerprint('progress_evaluation', null)).toBe('progress_evaluation:null');
  });

  it('computes deterministic guest dataset fingerprint regardless of input ordering', () => {
    const attempt2: PracticeAttempt = {
      ...sampleAttempt,
      id: '33333333-aaaa-4333-8333-333333333333',
      userInput: 'Second attempt',
    };
    const session2: SessionSummary = {
      ...sampleSession,
      id: '44444444-aaaa-4444-8444-444444444444',
      theme: 'Second theme',
    };

    const fp1 = computeGuestDatasetFingerprint([sampleSession, session2], [sampleAttempt, attempt2]);
    const fp2 = computeGuestDatasetFingerprint([session2, sampleSession], [attempt2, sampleAttempt]);

    expect(fp1).toBe(fp2);
  });

  it('changes dataset fingerprint when an attempt is added or modified', () => {
    const fp1 = computeGuestDatasetFingerprint([sampleSession], [sampleAttempt]);
    const attemptModified: PracticeAttempt = {
      ...sampleAttempt,
      userInput: 'Modified text',
    };
    const fp2 = computeGuestDatasetFingerprint([sampleSession], [attemptModified]);
    expect(fp1).not.toBe(fp2);
  });

  it('generates composite receipt key with entityType and entityId', () => {
    expect(makeReceiptKey('session', 'abc-123')).toBe('session:abc-123');
    expect(makeReceiptKey('practice_attempt', 'xyz-789')).toBe('practice_attempt:xyz-789');
    expect(makeReceiptKey('progress_evaluation', 'eval-456')).toBe('progress_evaluation:eval-456');
  });
});
