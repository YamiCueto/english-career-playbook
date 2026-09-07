import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { INITIAL_VOCABULARY, INTERVIEW_QUESTIONS } from '../../core/content/playbook-content';
import { VocabularyWord, InterviewQuestionItem } from '../../core/models/playbook.model';

@Component({
  selector: 'app-playbook',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './playbook.component.html',
  styleUrls: ['./playbook.component.css'],
})
export class PlaybookComponent {
  readonly vocabulary: VocabularyWord[] = INITIAL_VOCABULARY;
  readonly questions: InterviewQuestionItem[] = INTERVIEW_QUESTIONS;

  activeTab: 'vocab' | 'interview' = 'vocab';
  selectedCategory: string = 'all';

  get filteredVocabulary(): VocabularyWord[] {
    if (this.selectedCategory === 'all') {
      return this.vocabulary;
    }
    return this.vocabulary.filter((v) => v.category === this.selectedCategory);
  }
}
