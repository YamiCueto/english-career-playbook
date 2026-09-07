import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  private supabase: SupabaseClient | null = null;
  private currentUser: User | null = null;

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    const url = environment.supabaseUrl;
    const anonKey = environment.supabaseAnonKey;

    if (url && anonKey && url.startsWith('http')) {
      try {
        this.supabase = createClient(url, anonKey);
        this.supabase.auth.getUser().then(({ data }) => {
          this.currentUser = data.user;
        });
      } catch (err) {
        console.warn('Supabase initialization deferred: invalid configuration', err);
        this.supabase = null;
      }
    } else {
      // Offline / guest mode (expected in Sprint 0 until environment keys are set)
      this.supabase = null;
    }
  }

  get client(): SupabaseClient | null {
    return this.supabase;
  }

  get isConfigured(): boolean {
    return this.supabase !== null;
  }

  get user(): User | null {
    return this.currentUser;
  }
}
