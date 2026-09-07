import { Injectable, inject } from '@angular/core';
import { PracticeAttempt, SessionSummary } from '../models/session.model';
import { SupabaseService } from './supabase.service';

const ATTEMPTS_STORAGE_KEY = 'ecp_practice_attempts';
const SESSIONS_STORAGE_KEY = 'ecp_sessions_history';

@Injectable({
  providedIn: 'root',
})
export class PracticeStorageService {
  private supabaseService = inject(SupabaseService);

  getAttempts(): PracticeAttempt[] {
    try {
      const raw = localStorage.getItem(ATTEMPTS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  saveAttempt(attempt: Omit<PracticeAttempt, 'id' | 'timestamp'>): PracticeAttempt {
    const newAttempt: PracticeAttempt = {
      ...attempt,
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      timestamp: new Date().toISOString(),
    };

    const existing = this.getAttempts();
    const updated = [newAttempt, ...existing].slice(0, 100); // keep last 100 attempts
    localStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(updated));

    // If Supabase is connected and user authenticated, push to database asynchronously
    if (this.supabaseService.isConfigured && this.supabaseService.client && this.supabaseService.user) {
      this.supabaseService.client
        .from('practice_attempts')
        .insert({
          user_id: this.supabaseService.user.id,
          pattern_id: newAttempt.patternId,
          user_input: newAttempt.userInput,
          feedback_status: newAttempt.isValid ? 'valid' : 'needs_review',
        })
        .then(({ error }) => {
          if (error) console.error('Error syncing attempt to Supabase:', error);
        });
    }

    return newAttempt;
  }

  getSessions(): SessionSummary[] {
    try {
      const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  saveSession(session: SessionSummary): void {
    const existing = this.getSessions();
    const updated = [session, ...existing.filter((s) => s.id !== session.id)];
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(updated));
  }
}
