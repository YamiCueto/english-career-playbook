import {
  mapAttemptToDatabaseRow,
  mapDatabaseRowToAttempt,
  mapSessionToDatabaseRow,
  mapEvaluationToDatabaseRow,
  PracticeAttempt,
  SessionSummary,
  ProgressEvaluation,
} from './session.model';
import { Database } from './database.types';

describe('session.model mappers', () => {
  const userId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

  it('should map valid attempt to database row with feedback_status valid', () => {
    const attempt: PracticeAttempt = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      patternId: 'pattern-a',
      userInput: 'I develop backend services',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: true,
      sessionId: null,
    };

    const row = mapAttemptToDatabaseRow(attempt, userId);

    expect(row.id).toBe(attempt.id);
    expect(row.user_id).toBe(userId);
    expect(row.pattern_id).toBe('pattern-a');
    expect(row.user_input).toBe('I develop backend services');
    expect(row.feedback_status).toBe('valid');
    expect(row.session_id).toBeNull();
  });

  it('should map invalid attempt to database row with feedback_status needs_practice (never needs_review)', () => {
    const attempt: PracticeAttempt = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      patternId: 'pattern-a',
      userInput: 'I living in Colombia',
      timestamp: '2026-09-07T12:00:00.000Z',
      isValid: false,
      sessionId: '7f9c2d1b-1234-4567-89ab-cdef01234567',
    };

    const row = mapAttemptToDatabaseRow(attempt, userId);

    expect(row.feedback_status).toBe('needs_practice');
    expect(row.session_id).toBe('7f9c2d1b-1234-4567-89ab-cdef01234567');
  });

  it('should map database row to PracticeAttempt with synced status', () => {
    const row: Database['public']['Tables']['practice_attempts']['Row'] = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      user_id: userId,
      pattern_id: 'pattern-c',
      user_input: 'I modernized the payments API',
      feedback_status: 'valid',
      session_id: null,
      created_at: '2026-09-07T12:00:00.000Z',
    };

    const attempt = mapDatabaseRowToAttempt(row);

    expect(attempt.id).toBe(row.id);
    expect(attempt.patternId).toBe('pattern-c');
    expect(attempt.userInput).toBe('I modernized the payments API');
    expect(attempt.isValid).toBe(true);
    expect(attempt.syncStatus).toBe('synced');
  });

  it('should map session to database row', () => {
    const session: SessionSummary = {
      id: '11111111-2222-4333-8444-555555555555',
      date: '2026-09-07',
      durationMinutes: 45,
      theme: 'Architecture Interviews',
      notes: 'Reviewed system design patterns',
    };

    const row = mapSessionToDatabaseRow(session, userId);

    expect(row.id).toBe(session.id);
    expect(row.user_id).toBe(userId);
    expect(row.session_date).toBe('2026-09-07');
    expect(row.duration_minutes).toBe(45);
    expect(row.focus_theme).toBe('Architecture Interviews');
    expect(row.notes).toBe('Reviewed system design patterns');
  });

  it('should map evaluation to database row', () => {
    const evaluation: ProgressEvaluation = {
      comprehension: 5,
      construction: 4,
      vocabulary: 4,
      fluency: 3,
      grammar: 4,
      pronunciation: 4,
      newWordsCount: 12,
      nextGoal: 'Improve pronunciation of past tense -ed',
    };

    const row = mapEvaluationToDatabaseRow(
      evaluation,
      '11111111-2222-4333-8444-555555555555',
      userId
    );

    expect(row.session_id).toBe('11111111-2222-4333-8444-555555555555');
    expect(row.user_id).toBe(userId);
    expect(row.comprehension_score).toBe(5);
    expect(row.fluency_score).toBe(3);
    expect(row.new_words_count).toBe(12);
    expect(row.next_goal).toBe('Improve pronunciation of past tense -ed');
  });
});
