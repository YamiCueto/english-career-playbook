import { PracticeAttempt, ProgressEvaluation, SessionSummary } from '../models/session.model';
import { SyncEntityType } from '../models/sync.model';

export function canonicalizeEvaluation(evalData?: ProgressEvaluation | null): string {
  if (!evalData) {
    return 'null';
  }
  const normalized = {
    comprehension: Number(evalData.comprehension) || 1,
    construction: Number(evalData.construction) || 1,
    fluency: Number(evalData.fluency) || 1,
    grammar: Number(evalData.grammar) || 1,
    newWordsCount: Math.max(0, Math.round(Number(evalData.newWordsCount) || 0)),
    nextGoal: (evalData.nextGoal || '').trim(),
    pronunciation: Number(evalData.pronunciation) || 1,
    vocabulary: Number(evalData.vocabulary) || 1,
  };
  return JSON.stringify(normalized);
}

export function canonicalizeSession(session: SessionSummary): string {
  const normalized = {
    date: (session.date || '').trim(),
    durationMinutes: typeof session.durationMinutes === 'number' ? Math.round(session.durationMinutes) : 35,
    evaluation: session.evaluation ? JSON.parse(canonicalizeEvaluation(session.evaluation)) : null,
    notes: session.notes !== undefined && session.notes !== null ? String(session.notes).trim() : null,
    theme: (session.theme || '').trim(),
  };
  return JSON.stringify(normalized);
}

export function canonicalizeAttempt(attempt: PracticeAttempt): string {
  const normalized = {
    feedback: attempt.feedback !== undefined && attempt.feedback !== null ? String(attempt.feedback).trim() : null,
    isValid: Boolean(attempt.isValid),
    patternId: (attempt.patternId || '').trim(),
    sessionId: attempt.sessionId ? String(attempt.sessionId).trim() : null,
    timestamp: (attempt.timestamp || '').trim(),
    userInput: (attempt.userInput || '').trim(),
  };
  return JSON.stringify(normalized);
}

export function computeEntityFingerprint(entityType: SyncEntityType, entity: unknown): string {
  if (!entity || typeof entity !== 'object') {
    return `${entityType}:null`;
  }
  let canonicalContent = '';
  switch (entityType) {
    case 'session':
      canonicalContent = canonicalizeSession(entity as SessionSummary);
      break;
    case 'practice_attempt':
      canonicalContent = canonicalizeAttempt(entity as PracticeAttempt);
      break;
    case 'progress_evaluation':
      canonicalContent = canonicalizeEvaluation(entity as ProgressEvaluation);
      break;
  }
  let hash = 0;
  for (let i = 0; i < canonicalContent.length; i++) {
    const char = canonicalContent.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `${entityType}_fp_${Math.abs(hash).toString(16)}_${canonicalContent.length}`;
}

export function areEntitiesSemanticallyEqual(
  entityType: SyncEntityType,
  a: unknown,
  b: unknown
): boolean {
  return computeEntityFingerprint(entityType, a) === computeEntityFingerprint(entityType, b);
}

export function computeGuestDatasetFingerprint(
  sessions: SessionSummary[],
  attempts: PracticeAttempt[]
): string {
  const sortedSessions = [...sessions].sort((x, y) => x.id.localeCompare(y.id));
  const sortedAttempts = [...attempts].sort((x, y) => x.id.localeCompare(y.id));

  const sessionTokens = sortedSessions.map((s) => `${s.id}:${computeEntityFingerprint('session', s)}`);
  const attemptTokens = sortedAttempts.map((a) => `${a.id}:${computeEntityFingerprint('practice_attempt', a)}`);

  const raw = `${sessionTokens.join(';')}|${attemptTokens.join(';')}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `gfp_${sortedSessions.length}s_${sortedAttempts.length}a_${Math.abs(hash).toString(16)}`;
}

export function makeReceiptKey(entityType: SyncEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}
