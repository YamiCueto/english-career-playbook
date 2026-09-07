import { Injectable, OnDestroy, signal, computed, inject, InjectionToken } from '@angular/core';
import {
  createClient,
  SupabaseClient,
  User,
  Session,
  AuthChangeEvent,
  AuthError,
  Subscription,
} from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { Database } from '../models/database.types';

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface SupabaseConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export const SUPABASE_CONFIG = new InjectionToken<SupabaseConfig>('SUPABASE_CONFIG', {
  providedIn: 'root',
  factory: () => environment,
});

export const SUPABASE_CLIENT = new InjectionToken<SupabaseClient<Database> | null>('SUPABASE_CLIENT', {
  providedIn: 'root',
  factory: () => null,
});

@Injectable({
  providedIn: 'root',
})
export class SupabaseService implements OnDestroy {
  private config = inject(SUPABASE_CONFIG, { optional: true }) ?? environment;
  private injectedClient = inject(SUPABASE_CLIENT, { optional: true });
  private supabase: SupabaseClient<Database> | null = null;
  private authSubscription: Subscription | null = null;
  private authGeneration = 0;

  readonly currentUser = signal<User | null>(null);
  readonly currentSession = signal<Session | null>(null);
  readonly currentProfile = signal<ProfileRow | null>(null);
  readonly isInitialized = signal<boolean>(false);
  readonly authLoading = signal<boolean>(false);
  readonly authError = signal<string | null>(null);
  readonly restorationError = signal<string | null>(null);
  readonly profileLoading = signal<boolean>(false);
  readonly profileError = signal<string | null>(null);

  readonly isAuthenticatedSignal = computed(() => this.currentUser() !== null);

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    if (this.injectedClient) {
      this.supabase = this.injectedClient;
      this.initAuth();
      return;
    }

    const url = this.config.supabaseUrl;
    const anonKey = this.config.supabaseAnonKey;

    if (url && anonKey && url.startsWith('http')) {
      try {
        this.supabase = createClient<Database>(url, anonKey, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
          },
        });
        this.initAuth();
      } catch {
        this.supabase = null;
        this.isInitialized.set(true);
      }
    } else {
      this.supabase = null;
      this.isInitialized.set(true);
    }
  }

  private initAuth(): void {
    if (!this.supabase) {
      this.isInitialized.set(true);
      return;
    }

    const { data } = this.supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        this.handleAuthStateChange(event, session);
      }
    );
    this.authSubscription = data.subscription;

    const restorationGen = this.authGeneration;

    this.supabase.auth
      .getSession()
      .then(({ data: sessionData, error }) => {
        if (this.authGeneration !== restorationGen) {
          return;
        }
        if (error) {
          this.restorationError.set(error.message);
          this.authError.set(error.message);
          this.isInitialized.set(true);
          return;
        }
        if (!this.isInitialized() || (sessionData?.session && !this.currentSession())) {
          this.handleAuthStateChange('INITIAL_SESSION', sessionData?.session ?? null);
        }
      })
      .catch((err: unknown) => {
        if (this.authGeneration !== restorationGen) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Session restoration failed';
        this.restorationError.set(message);
        this.authError.set(message);
        this.isInitialized.set(true);
      });
  }

  private handleAuthStateChange(event: AuthChangeEvent, session: Session | null): void {
    const isDuplicate =
      session !== null &&
      this.currentSession()?.access_token === session.access_token &&
      this.currentUser()?.id === session.user.id;

    if (isDuplicate && this.isInitialized()) {
      return;
    }

    this.currentSession.set(session);
    this.currentUser.set(session?.user ?? null);

    if (session !== null || event !== 'INITIAL_SESSION' || !this.restorationError()) {
      this.authError.set(null);
      this.restorationError.set(null);
    }

    const generation = ++this.authGeneration;

    switch (event) {
      case 'INITIAL_SESSION':
        this.isInitialized.set(true);
        if (session?.user) {
          queueMicrotask(() => this.fetchProfile(session.user.id, generation));
        }
        break;
      case 'SIGNED_IN':
        this.isInitialized.set(true);
        if (session?.user) {
          queueMicrotask(() => this.fetchProfile(session.user.id, generation));
        }
        break;
      case 'SIGNED_OUT':
        this.clearIdentityState();
        this.isInitialized.set(true);
        break;
      case 'TOKEN_REFRESHED':
        if (session?.user && !this.currentProfile()) {
          queueMicrotask(() => this.fetchProfile(session.user.id, generation));
        }
        break;
    }
  }

  private async fetchProfile(userId: string, generation: number): Promise<void> {
    if (!this.supabase) {
      return;
    }

    this.profileLoading.set(true);
    this.profileError.set(null);

    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (this.authGeneration !== generation || this.currentUser()?.id !== userId) {
        return;
      }

      if (error) {
        this.profileError.set(error.message);
        return;
      }

      this.currentProfile.set(data);
    } catch (err: unknown) {
      if (this.authGeneration === generation && this.currentUser()?.id === userId) {
        const message = err instanceof Error ? err.message : 'Error loading profile';
        this.profileError.set(message);
      }
    } finally {
      if (this.authGeneration === generation) {
        this.profileLoading.set(false);
      }
    }
  }

  private clearIdentityState(): void {
    this.currentUser.set(null);
    this.currentSession.set(null);
    this.currentProfile.set(null);
    this.profileError.set(null);
    this.profileLoading.set(false);
  }

  async signIn(email: string, password: string): Promise<{ data: { user: User | null; session: Session | null }; error: AuthError | null }> {
    if (!this.supabase) {
      const err = new AuthError('Supabase client is not configured');
      this.authError.set(err.message);
      return { data: { user: null, session: null }, error: err };
    }
    this.authLoading.set(true);
    this.authError.set(null);
    try {
      const result = await this.supabase.auth.signInWithPassword({ email, password });
      if (result.error) {
        this.authError.set(result.error.message);
      }
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error signing in';
      const authErr = new AuthError(message);
      this.authError.set(authErr.message);
      return { data: { user: null, session: null }, error: authErr };
    } finally {
      this.authLoading.set(false);
    }
  }

  async signUp(email: string, password: string, displayName?: string): Promise<{ data: { user: User | null; session: Session | null }; error: AuthError | null }> {
    if (!this.supabase) {
      const err = new AuthError('Supabase client is not configured');
      this.authError.set(err.message);
      return { data: { user: null, session: null }, error: err };
    }
    this.authLoading.set(true);
    this.authError.set(null);
    try {
      const options = displayName
        ? { data: { full_name: displayName, name: displayName } }
        : undefined;
      const result = await this.supabase.auth.signUp({ email, password, options });
      if (result.error) {
        this.authError.set(result.error.message);
      }
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error signing up';
      const authErr = new AuthError(message);
      this.authError.set(authErr.message);
      return { data: { user: null, session: null }, error: authErr };
    } finally {
      this.authLoading.set(false);
    }
  }

  async signOut(): Promise<{ error: AuthError | null }> {
    this.authLoading.set(true);
    this.authError.set(null);
    ++this.authGeneration;

    if (!this.supabase) {
      this.clearIdentityState();
      this.authLoading.set(false);
      return { error: null };
    }

    try {
      const result = await this.supabase.auth.signOut();
      this.clearIdentityState();
      if (result.error) {
        this.authError.set(result.error.message);
      }
      return result;
    } catch (err: unknown) {
      this.clearIdentityState();
      const message = err instanceof Error ? err.message : 'Error signing out';
      const authErr = new AuthError(message);
      this.authError.set(authErr.message);
      return { error: authErr };
    } finally {
      this.authLoading.set(false);
    }
  }

  get client(): SupabaseClient<Database> | null {
    return this.supabase;
  }

  get isConfigured(): boolean {
    return this.supabase !== null;
  }

  get isAuthenticated(): boolean {
    return this.currentUser() !== null;
  }

  get user(): User | null {
    return this.currentUser();
  }

  get profile(): ProfileRow | null {
    return this.currentProfile();
  }

  get syncStatusLabel(): string {
    if (this.supabase && this.isAuthenticated) {
      return 'Sesión Activa';
    }
    if (this.supabase) {
      return 'Supabase Listo (Modo Local)';
    }
    return 'Almacenamiento Local';
  }

  ngOnDestroy(): void {
    this.authSubscription?.unsubscribe();
  }
}
