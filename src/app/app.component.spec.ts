import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app.component';
import { SupabaseService, ProfileRow } from './core/services/supabase.service';
import { RemoteSyncService } from './core/services/remote-sync.service';
import { routes } from './app.routes';
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

  let router: Router;
  let remoteSyncService: RemoteSyncService;

  beforeEach(async () => {
    currentUserSignal.set(null);
    currentSessionSignal.set(null);
    currentProfileSignal.set(null);
    restorationErrorSignal.set(null);
    profileErrorSignal.set(null);

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        { provide: SupabaseService, useValue: mockSupabaseService },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    remoteSyncService = TestBed.inject(RemoteSyncService);
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
    expect(app.connectionStatus()).toBe('restoration-error');
    expect(app.connectionLabel()).toBe('Error de Sesión');
  });

  it('should distinguish profileError from disconnection while authenticated', () => {
    currentUserSignal.set(mockUser);
    currentProfileSignal.set(null);
    profileErrorSignal.set('Failed to fetch profile');

    expect(app.connectionStatus()).toBe('profile-warning');
    expect(app.connectionLabel()).toBe('Sesión Activa (Sin Perfil)');
    expect(app.userDisplayName()).toBe('Yamid Cueto');
  });

  it('should handle remote signOut failure and show comprehensible alert', async () => {
    mockSupabaseService.signOut.mockResolvedValueOnce({
      error: { message: 'Remote network error' },
    });

    await app.handleSignOut();

    expect(mockSupabaseService.signOut).toHaveBeenCalled();
    expect(app.signOutError()).toContain('No se pudo revocar la sesión remota');

    app.dismissSignOutError();
    expect(app.signOutError()).toBeNull();
  });

  it('should ignore escape key when auth modal is open', () => {
    app.isAuthModalOpen.set(true);
    app.isUserMenuOpen.set(true);

    app.handleEscape();

    expect(app.isUserMenuOpen()).toBe(true);
  });

  describe('Global Lifecycle & RemoteSync Initialization', () => {
    it('debe activar RemoteSyncService en arranque directo en /playbook con sesion restaurada sin depender de PracticeStorageService', async () => {
      currentUserSignal.set(mockUser);
      await router.navigateByUrl('/playbook');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(router.url).toBe('/playbook');
      expect(remoteSyncService.currentUserId).toBe('user-abc-123');
      expect(app.syncStatus()).toBeDefined();
    });

    it('debe inicializar RemoteSyncService en arranque directo en /dashboard', async () => {
      currentUserSignal.set(mockUser);
      await router.navigateByUrl('/dashboard');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(router.url).toBe('/dashboard');
      expect(remoteSyncService.currentUserId).toBe('user-abc-123');
    });

    it('debe inicializar RemoteSyncService en arranque directo en /practice', async () => {
      currentUserSignal.set(mockUser);
      await router.navigateByUrl('/practice');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(router.url).toBe('/practice');
      expect(remoteSyncService.currentUserId).toBe('user-abc-123');
    });

    it('debe activar RemoteSyncService tras login posterior al arranque', async () => {
      expect(remoteSyncService.currentUserId).toBeNull();
      expect(remoteSyncService.syncStatus()).toBe('local');

      currentUserSignal.set(mockUser);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(remoteSyncService.currentUserId).toBe('user-abc-123');
    });

    it('debe invalidar estado y cambiar de cuenta correctamente ante logout y nuevo login', async () => {
      currentUserSignal.set(mockUser);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(remoteSyncService.currentUserId).toBe('user-abc-123');

      currentUserSignal.set(null);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(remoteSyncService.currentUserId).toBeNull();
      expect(remoteSyncService.syncStatus()).toBe('local');

      const nextUser: User = {
        ...mockUser,
        id: 'user-xyz-789',
        email: 'other@playbook.dev',
      };
      currentUserSignal.set(nextUser);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(remoteSyncService.currentUserId).toBe('user-xyz-789');
    });

    it('no inicializa dos veces el motor ni duplica listeners en el root injector', () => {
      const instance1 = TestBed.inject(RemoteSyncService);
      const instance2 = TestBed.inject(RemoteSyncService);
      expect(instance1).toBe(instance2);
    });

    it('renders guest claim modal when prompt is visible', async () => {
      app.guestClaimService.isClaimPromptVisible.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const modal = fixture.nativeElement.querySelector('.claim-modal-card');
      expect(modal).toBeTruthy();
    });

    it('does not render guest claim modal when prompt is not visible', async () => {
      app.guestClaimService.isClaimPromptVisible.set(false);
      fixture.detectChanges();
      await fixture.whenStable();

      const modal = fixture.nativeElement.querySelector('.claim-modal-card');
      expect(modal).toBeNull();
    });
  });
});
