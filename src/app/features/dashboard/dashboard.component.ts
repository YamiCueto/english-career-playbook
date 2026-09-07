import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PracticeStorageService } from '../../core/services/practice-storage.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { LEARNING_PHASES, INITIAL_VOCABULARY, SENTENCE_PATTERNS } from '../../core/content/playbook-content';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})
export class DashboardComponent {
  private storageService = inject(PracticeStorageService);
  public supabaseService = inject(SupabaseService);

  readonly phases = LEARNING_PHASES;
  readonly patternsCount = SENTENCE_PATTERNS.length;
  readonly vocabularyCount = INITIAL_VOCABULARY.length;

  get attempts() {
    return this.storageService.getAttempts();
  }

  get successfulAttemptsCount() {
    return this.attempts.filter((a) => a.isValid).length;
  }
}
