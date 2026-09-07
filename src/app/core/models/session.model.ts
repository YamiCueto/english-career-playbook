import { SyncStatus } from './sync.model';
import { Database } from './database.types';

export type PracticeAttemptRow = Database['public']['Tables']['practice_attempts']['Row'];
export type PracticeAttemptInsert = Database['public']['Tables']['practice_attempts']['Insert'];
export type SessionRow = Database['public']['Tables']['sessions']['Row'];
export type SessionInsert = Database['public']['Tables']['sessions']['Insert'];
export type ProgressEvaluationRow = Database['public']['Tables']['progress_evaluations']['Row'];
export type ProgressEvaluationInsert = Database['public']['Tables']['progress_evaluations']['Insert'];

export interface PracticeAttempt {
  id: string;
  patternId: string;
  userInput: string;
  timestamp: string;
  isValid: boolean;
  feedback?: string;
  sessionId?: string | null;
  syncStatus?: SyncStatus;
  claimedBy?: string | null;
  claimedAt?: string | null;
}

export interface ProgressEvaluation {
  comprehension: number;
  construction: number;
  vocabulary: number;
  fluency: number;
  grammar: number;
  pronunciation: number;
  newWordsCount: number;
  nextGoal: string;
}

export interface SessionSummary {
  id: string;
  date: string;
  durationMinutes: number;
  theme: string;
  notes?: string;
  evaluation?: ProgressEvaluation;
  syncStatus?: SyncStatus;
  claimedBy?: string | null;
  claimedAt?: string | null;
}

export function mapAttemptToDatabaseRow(
  attempt: PracticeAttempt,
  userId: string
): PracticeAttemptInsert {
  return {
    id: attempt.id,
    user_id: userId,
    session_id: attempt.sessionId ?? null,
    pattern_id: attempt.patternId,
    user_input: attempt.userInput,
    feedback_status: attempt.isValid ? 'valid' : 'needs_practice',
    created_at: attempt.timestamp,
  };
}

export function mapDatabaseRowToAttempt(row: PracticeAttemptRow): PracticeAttempt {
  return {
    id: row.id,
    patternId: row.pattern_id,
    userInput: row.user_input,
    timestamp: row.created_at,
    isValid: row.feedback_status === 'valid' || row.feedback_status === 'mastered',
    feedback: row.feedback_status,
    sessionId: row.session_id,
    syncStatus: 'synced',
  };
}

export function mapSessionToDatabaseRow(
  session: SessionSummary,
  userId: string
): SessionInsert {
  return {
    id: session.id,
    user_id: userId,
    session_date: session.date,
    duration_minutes: Math.max(1, Math.min(480, Math.round(session.durationMinutes || 35))),
    focus_theme: session.theme.trim() || 'General Practice',
    notes: session.notes ?? null,
  };
}

export function mapEvaluationToDatabaseRow(
  evaluation: ProgressEvaluation,
  sessionId: string,
  userId: string
): ProgressEvaluationInsert {
  const clampScore = (score: number | null | undefined): number =>
    Math.max(1, Math.min(5, Math.round(score ?? 1)));

  return {
    session_id: sessionId,
    user_id: userId,
    comprehension_score: clampScore(evaluation.comprehension),
    construction_score: clampScore(evaluation.construction),
    vocabulary_score: clampScore(evaluation.vocabulary),
    fluency_score: clampScore(evaluation.fluency),
    grammar_score: clampScore(evaluation.grammar),
    pronunciation_score: clampScore(evaluation.pronunciation),
    new_words_count: Math.max(0, Math.round(evaluation.newWordsCount || 0)),
    next_goal: evaluation.nextGoal ?? null,
  };
}

export function mapDatabaseRowToSession(
  row: SessionRow,
  evaluation?: ProgressEvaluation
): SessionSummary {
  return {
    id: row.id,
    date: row.session_date,
    durationMinutes: row.duration_minutes,
    theme: row.focus_theme,
    notes: row.notes ?? undefined,
    evaluation,
    syncStatus: 'synced',
  };
}

export function mapDatabaseRowToEvaluation(row: ProgressEvaluationRow): ProgressEvaluation {
  return {
    comprehension: row.comprehension_score ?? 1,
    construction: row.construction_score ?? 1,
    vocabulary: row.vocabulary_score ?? 1,
    fluency: row.fluency_score ?? 1,
    grammar: row.grammar_score ?? 1,
    pronunciation: row.pronunciation_score ?? 1,
    newWordsCount: row.new_words_count,
    nextGoal: row.next_goal ?? '',
  };
}
