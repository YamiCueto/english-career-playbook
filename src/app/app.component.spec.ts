import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app.component';
import { SupabaseService, ProfileRow } from './core/services/supabase.service';
import { signal, computed } from '@angular/core';
import { User, Session } from '@supabase/supabase-js';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let app: App;

  const mockUser: User = {
    id: 'user-abc-123',
    app_metadata: {},
    user_metadata: { full_name: 'Yamid Cueto' },
    aud: 'authenticated',
    created_at: '2026-09-07T00:00:00Z',
    email: 'yamid@playbook.dev',
  };

  const mockSession: Session = {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: mockUser,
  };

  const mockProfile: ProfileRow = {
    id: 'user-abc-123',
    display_name: 'Yamid Cueto',
    avatar_url: null,
    preferred_language: 'es',
    timezone: 'UTC',
    created_at: '2026-09-07T00:00:00Z',
    updated_at: '2026-09-07T00:00:00Z',
  };

  let currentUserSignal = signal<User | null>(null);
  let currentSessionSignal = signal<Session | null>(null);
  let currentProfileSignal = signal<ProfileRow | null>(null);
  let restorationErrorSignal = signal<string | null>(null);
  let profileErrorSignal = signal<string | null>(null);
  let authLoadingSignal = signal<boolean>(false);
  let authErrorSignal = signal<string | null>(null);

  const mockSupabaseService = {
    currentUser: currentUserSignal,
    currentSession: currentSessionSignal,
    currentProfile: currentProfileSignal,
    restorationError: restorationErrorSignal,
    profileError: profileErrorSignal,
    authLoading: authLoadingSignal,
    authError: authErrorSignal,
    isInitialized: signal(true),
    profileLoading: signal(false),
    get isAuthenticated() {
      return currentUserSignal() !== null;
    },
    isAuthenticatedSignal: computed(() => currentUserSignal() !== null),
    isConfigured: true,
    syncStatusLabel: 'Modo Local',
    signOut: vi.fn().mockImplementation(async () => {
      currentUserSignal.set(null);
      currentSessionSignal.set(null);
      currentProfileSignal.set(null);
      return { error: null };
    }),
    signIn: vi.fn(),
    signUp: vi.fn(),
  };

  beforeEach(async () => {
    currentUserSignal.set(null);
    currentSessionSignal.set(null);
    currentProfileSignal.set(null);
    restorationErrorSignal.set(null);
    profileErrorSignal.set(null);

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: SupabaseService, useValue: mockSupabaseService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the app', () => {
    expect(app).toBeTruthy();
  });

  it('should render brand title in navbar', async () => {
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand-title')?.textContent).toContain('Career Playbook');
  });

  it('should display guest mode and Acceder button when unauthenticated', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(app.connectionStatus()).toBe('guest');
    expect(app.connectionLabel()).toBe('Modo Invitado');
    expect(compiled.querySelector('.auth-trigger-btn')).toBeTruthy();
    expect(compiled.querySelector('.auth-trigger-btn')?.textContent).toContain('Acceder');
    expect(compiled.querySelector('.user-avatar-btn')).toBeFalsy();
  });

  it('should open and close auth modal', () => {
    expect(app.isAuthModalOpen()).toBe(false);

    app.openAuthModal('signin');
    expect(app.isAuthModalOpen()).toBe(true);
    expect(app.authModalMode()).toBe('signin');

    app.closeAuthModal();
    expect(app.isAuthModalOpen()).toBe(false);

    app.openAuthModal('signup');
    expect(app.isAuthModalOpen()).toBe(true);
    expect(app.authModalMode()).toBe('signup');
  });

  it('should display authenticated user identity and initials when logged in', async () => {
    currentUserSignal.set(mockUser);
    currentProfileSignal.set(mockProfile);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(app.connectionStatus()).toBe('authenticated');
    expect(app.connectionLabel()).toBe('Sesión Activa');
    expect(app.userInitials()).toBe('YC');
    expect(app.userDisplayName()).toBe('Yamid Cueto');
    expect(app.userEmail()).toBe('yamid@playbook.dev');

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.auth-trigger-btn')).toBeFalsy();
    expect(compiled.querySelector('.user-avatar-btn')).toBeTruthy();
    expect(compiled.querySelector('.user-avatar-circle')?.textContent).toBe('YC');
  });

  it('should compute initials from email fallback if profile name is absent', () => {
    currentUserSignal.set({
      ...mockUser,
      user_metadata: {},
      email: 'dev@company.io',
    });
    currentProfileSignal.set(null);

    expect(app.userInitials()).toBe('DE');
    expect(app.userDisplayName()).toBe('dev');
  });

  it('should toggle user dropdown menu and handle signOut', async () => {
    currentUserSignal.set(mockUser);
    currentProfileSignal.set(mockProfile);
    fixture.detectChanges();

    expect(app.isUserMenuOpen()).toBe(false);
    app.toggleUserMenu();
    expect(app.isUserMenuOpen()).toBe(true);

    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.user-dropdown-card')).toBeTruthy();

    await app.handleSignOut();
    expect(mockSupabaseService.signOut).toHaveBeenCalled();
    expect(app.isUserMenuOpen()).toBe(false);
  });

  it('should close user dropdown on escape key', () => {
    app.isUserMenuOpen.set(true);
    app.handleEscape();
    expect(app.isUserMenuOpen()).toBe(false);
  });

  it('should reflect error connection status when restorationError is set', () => {
    restorationErrorSignal.set('Failed to restore session');
    expect(app.connectionStatus()).toBe('error');
    expect(app.connectionLabel()).toBe('Sin Conexión');
  });
});
