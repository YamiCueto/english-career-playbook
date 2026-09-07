export interface PracticeAttempt {
  id: string;
  patternId: string;
  userInput: string;
  timestamp: string;
  isValid: boolean;
  feedback?: string;
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
}
