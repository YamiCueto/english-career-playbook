export interface PracticeAttempt {
  id: string;
  patternId: string;
  userInput: string;
  timestamp: string;
  isValid: boolean;
  feedback?: string;
}

export interface ProgressEvaluation {
  comprehension: number; // 1-5
  construction: number; // 1-5
  vocabulary: number; // 1-5
  fluency: number; // 1-5
  grammar: number; // 1-5
  pronunciation: number; // 1-5
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
