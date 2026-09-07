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
    duration_minutes: session.durationMinutes,
    focus_theme: session.theme,
    notes: session.notes ?? null,
  };
}

export function mapEvaluationToDatabaseRow(
  evaluation: ProgressEvaluation,
  sessionId: string,
  userId: string
): ProgressEvaluationInsert {
  return {
    session_id: sessionId,
    user_id: userId,
    comprehension_score: evaluation.comprehension,
    construction_score: evaluation.construction,
    vocabulary_score: evaluation.vocabulary,
    fluency_score: evaluation.fluency,
    grammar_score: evaluation.grammar,
    pronunciation_score: evaluation.pronunciation,
    new_words_count: evaluation.newWordsCount,
    next_goal: evaluation.nextGoal,
  };
}
