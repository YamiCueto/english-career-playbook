export interface SentencePattern {
  id: string;
  name: string;
  formula: string;
  explanation: string;
  examples: string[];
  practicePrompt: string;
  starterVerbs: string[];
}

export interface VocabularyWord {
  english: string;
  spanish: string;
  example: string;
  category: 'core' | 'technical' | 'workplace';
}

export interface InterviewQuestionItem {
  id: number;
  question: string;
  category: 'introduction' | 'technical' | 'experience' | 'behavioral' | 'motivation';
  referenceResponse?: string;
}

export interface LearningPhase {
  phaseNumber: number;
  title: string;
  description: string;
  focusTopics: string[];
}
