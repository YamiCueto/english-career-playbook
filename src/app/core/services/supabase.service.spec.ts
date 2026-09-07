import { TestBed } from '@angular/core/testing';
import { SupabaseService, SUPABASE_CONFIG, SUPABASE_CLIENT, ProfileRow } from './supabase.service';
import { AuthError, Session, User } from '@supabase/supabase-js';

describe('SupabaseService', () => {
  describe('Unconfigured Environment', () => {
    let service: SupabaseService;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          {
            provide: SUPABASE_CONFIG,
            useValue: { supabaseUrl: '', supabaseAnonKey: '' },
          },
        ],
      });
      service = TestBed.inject(SupabaseService);
    });

    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should handle unconfigured environment gracefully', () => {
      expect(service.isConfigured).toBe(false);
      expect(service.client).toBeNull();
      expect(service.isAuthenticated).toBe(false);
      expect(service.isAuthenticatedSignal()).toBe(false);
      expect(service.syncStatusLabel).toBe('Almacenamiento Local');
      expect(service.isInitialized()).toBe(true);
    });

    it('should return error when attempting signIn while unconfigured', async () => {
      const res = await service.signIn('test@domain.com', 'password');
      expect(res.error).toBeInstanceOf(AuthError);
      expect(service.authError()).toContain('not configured');
    });

    it('should return error when attempting signUp while unconfigured', async () => {
      const res = await service.signUp('test@domain.com', 'password');
      expect(res.error).toBeInstanceOf(AuthError);
      expect(service.authError()).toContain('not configured');
    });

    it('should handle signOut cleanly while unconfigured', async () => {
      const res = await service.signOut();
      expect(res.error).toBeNull();
      expect(service.currentUser()).toBeNull();
    });
  });

  describe('Configured Environment with Mocks', () => {
    let service: SupabaseService;
    let authCallback: ((event: string, session: Session | null) => void) | null = null;

    const mockUser: User = {
      id: 'user-uuid-1',
      app_metadata: {},
      user_metadata: { full_name: 'Test User' },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
      email: 'test@domain.com',
    };

    const mockSession: Session = {
      access_token: 'fake-token-1',
      refresh_token: 'fake-refresh-1',
      expires_in: 3600,
      token_type: 'bearer',
      user: mockUser,
    };

    const mockProfile: ProfileRow = {
      id: 'user-uuid-1',
      display_name: 'Test Learner',
      avatar_url: null,
      preferred_language: 'es',
      timezone: 'UTC',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let mockClient: any;

    beforeEach(() => {
      authCallback = null;

      mockClient = {
        auth: {
          onAuthStateChange: vi.fn().mockImplementation((cb: any) => {
            authCallback = cb;
            return {
              data: {
                subscription: {
                  unsubscribe: vi.fn(),
                },
              },
            };
          }),
          getSession: vi.fn().mockResolvedValue({
            data: { session: null },
            error: null,
          }),
          signInWithPassword: vi.fn(),
          signUp: vi.fn(),
          signOut: vi.fn(),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null,
              }),
            }),
          }),
        }),
      };

      TestBed.configureTestingModule({
        providers: [
          {
            provide: SUPABASE_CONFIG,
            useValue: {
              supabaseUrl: 'https://test-project.supabase.co',
              supabaseAnonKey: 'test-anon-key',
            },
          },
          {
            provide: SUPABASE_CLIENT,
            useValue: mockClient,
          },
        ],
      });

      service = TestBed.inject(SupabaseService);
    });

    it('should report configured and unauthenticated initially', () => {
      expect(service.isConfigured).toBe(true);
      expect(service.isAuthenticated).toBe(false);
      expect(service.isAuthenticatedSignal()).toBe(false);
      expect(service.syncStatusLabel).toBe('Supabase Listo (Modo Local)');
    });

    it('should restore session and load profile on INITIAL_SESSION', async () => {
      authCallback?.('INITIAL_SESSION', mockSession);

      expect(service.currentSession()).toEqual(mockSession);
      expect(service.currentUser()).toEqual(mockUser);
      expect(service.isAuthenticated).toBe(true);
      expect(service.isAuthenticatedSignal()).toBe(true);
      expect(service.syncStatusLabel).toBe('Sesión Activa');

      await new Promise((r) => setTimeout(r, 10));

      expect(mockClient.from).toHaveBeenCalledWith('profiles');
      expect(service.currentProfile()).toEqual(mockProfile);
    });

    it('should handle failed session restoration without blocking app initialization', async () => {
      const getSessionError = new AuthError('Token refresh expired');
      mockClient.auth.getSession.mockResolvedValueOnce({
        data: { session: null },
        error: getSessionError,
      });

      const failedTestBed = TestBed.resetTestingModule().configureTestingModule({
        providers: [
          {
            provide: SUPABASE_CONFIG,
            useValue: {
              supabaseUrl: 'https://test-project.supabase.co',
              supabaseAnonKey: 'test-anon-key',
            },
          },
          {
            provide: SUPABASE_CLIENT,
            useValue: mockClient,
          },
        ],
      });

      const restoredService = failedTestBed.inject(SupabaseService);
      await new Promise((r) => setTimeout(r, 10));

      expect(restoredService.isInitialized()).toBe(true);
      expect(restoredService.restorationError()).toBe('Token refresh expired');
      expect(restoredService.authError()).toBe('Token refresh expired');
      expect(restoredService.currentUser()).toBeNull();
      expect(restoredService.isAuthenticated).toBe(false);
    });

    it('should ignore duplicate SIGNED_IN events and avoid redundant profile queries', async () => {
      authCallback?.('SIGNED_IN', mockSession);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockClient.from).toHaveBeenCalledTimes(1);

      authCallback?.('SIGNED_IN', mockSession);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockClient.from).toHaveBeenCalledTimes(1);
    });

    it('should discard in-flight profile fetch if signOut is called during loading', async () => {
      let resolveSlowProfile: any;
      const slowPromise = new Promise((res) => {
        resolveSlowProfile = res;
      });

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockImplementation(() => slowPromise),
          }),
        }),
      });

      authCallback?.('SIGNED_IN', mockUserSession('user-slow-1'));
      expect(service.currentUser()?.id).toBe('user-slow-1');

      mockClient.auth.signOut.mockResolvedValue({ error: null });
      await service.signOut();

      expect(service.currentUser()).toBeNull();
      expect(service.currentProfile()).toBeNull();
      expect(service.profileLoading()).toBe(false);

      resolveSlowProfile({
        data: { ...mockProfile, id: 'user-slow-1' },
        error: null,
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(service.currentProfile()).toBeNull();
      expect(service.profileLoading()).toBe(false);
    });

    it('should discard stale profile from prior login on rapid re-login of the same user', async () => {
      let resolveFirstProfile: any;
      const firstSlowPromise = new Promise((res) => {
        resolveFirstProfile = res;
      });

      let resolveSecondProfile: any;
      const secondFastPromise = new Promise((res) => {
        resolveSecondProfile = res;
      });

      let callCount = 0;
      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockImplementation(() => {
              callCount++;
              return callCount === 1 ? firstSlowPromise : secondFastPromise;
            }),
          }),
        }),
      });

      authCallback?.('SIGNED_IN', mockSession);

      authCallback?.('SIGNED_IN', {
        ...mockSession,
        access_token: 'fake-token-relogin-same-user',
      });

      const updatedProfile: ProfileRow = {
        ...mockProfile,
        display_name: 'Fresh Learner Update',
      };

      resolveSecondProfile({
        data: updatedProfile,
        error: null,
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(service.currentProfile()?.display_name).toBe('Fresh Learner Update');

      resolveFirstProfile({
        data: {
          ...mockProfile,
          display_name: 'Stale Old Learner',
        },
        error: null,
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(service.currentProfile()?.display_name).toBe('Fresh Learner Update');
    });

    it('should observe profile loading errors without polluting authError', async () => {
      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database query timeout' },
            }),
          }),
        }),
      });

      authCallback?.('SIGNED_IN', mockSession);
      await new Promise((r) => setTimeout(r, 10));

      expect(service.profileError()).toBe('Database query timeout');
      expect(service.authError()).toBeNull();
      expect(service.currentProfile()).toBeNull();
      expect(service.profileLoading()).toBe(false);
    });

    it('should clear local identity completely even if remote signOut fails', async () => {
      authCallback?.('SIGNED_IN', mockSession);
      await new Promise((r) => setTimeout(r, 10));
      expect(service.currentUser()).toEqual(mockUser);

      const networkError = new AuthError('Network request failed');
      mockClient.auth.signOut.mockResolvedValue({ error: networkError });

      const result = await service.signOut();

      expect(result.error).toBe(networkError);
      expect(service.authError()).toBe('Network request failed');
      expect(service.currentUser()).toBeNull();
      expect(service.currentSession()).toBeNull();
      expect(service.currentProfile()).toBeNull();
      expect(service.isAuthenticated).toBe(false);
    });

    it('should sign in successfully and update session', async () => {
      mockClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const res = await service.signIn('test@domain.com', 'correct-password');
      expect(res.error).toBeNull();
      expect(res.data.user).toEqual(mockUser);
      expect(service.authLoading()).toBe(false);
      expect(service.authError()).toBeNull();
    });

    it('should handle signIn error appropriately', async () => {
      const err = new AuthError('Invalid login credentials');
      mockClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: err,
      });

      const res = await service.signIn('test@domain.com', 'wrong-password');
      expect(res.error).toEqual(err);
      expect(service.authError()).toBe('Invalid login credentials');
      expect(service.authLoading()).toBe(false);
    });

    it('should sign up successfully with metadata', async () => {
      mockClient.auth.signUp.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const res = await service.signUp('new@domain.com', 'password', 'New User');
      expect(res.error).toBeNull();
      expect(mockClient.auth.signUp).toHaveBeenCalledWith({
        email: 'new@domain.com',
        password: 'password',
        options: {
          data: {
            full_name: 'New User',
            name: 'New User',
          },
        },
      });
    });

    it('should handle signUp error', async () => {
      const err = new AuthError('User already registered');
      mockClient.auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: err,
      });

      const res = await service.signUp('existing@domain.com', 'password');
      expect(res.error).toEqual(err);
      expect(service.authError()).toBe('User already registered');
    });

    it('should discard stale getSession resolution if auth state has already transitioned', async () => {
      let resolveDelayedSession: any;
      const delayedGetSession = new Promise((res) => {
        resolveDelayedSession = res;
      });

      mockClient.auth.getSession.mockImplementation(() => delayedGetSession);

      const isolatedTestBed = TestBed.resetTestingModule().configureTestingModule({
        providers: [
          {
            provide: SUPABASE_CONFIG,
            useValue: {
              supabaseUrl: 'https://test-project.supabase.co',
              supabaseAnonKey: 'test-anon-key',
            },
          },
          {
            provide: SUPABASE_CLIENT,
            useValue: mockClient,
          },
        ],
      });

      const delayedService = isolatedTestBed.inject(SupabaseService);

      authCallback?.('SIGNED_IN', mockSession);
      expect(delayedService.currentUser()?.id).toBe(mockUser.id);
      expect(delayedService.currentSession()?.access_token).toBe(mockSession.access_token);

      resolveDelayedSession({
        data: { session: null },
        error: null,
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(delayedService.currentUser()?.id).toBe(mockUser.id);
      expect(delayedService.currentSession()?.access_token).toBe(mockSession.access_token);
    });

    it('should handle thrown unexpected error in signOut cleanly', async () => {
      authCallback?.('SIGNED_IN', mockSession);
      expect(service.isAuthenticated).toBe(true);

      mockClient.auth.signOut.mockRejectedValue(new Error('Fatal connection drop'));

      const result = await service.signOut();

      expect(result.error).toBeInstanceOf(AuthError);
      expect(result.error?.message).toBe('Fatal connection drop');
      expect(service.authError()).toBe('Fatal connection drop');
      expect(service.currentUser()).toBeNull();
      expect(service.currentSession()).toBeNull();
      expect(service.currentProfile()).toBeNull();
      expect(service.isAuthenticated).toBe(false);
    });

    it('should handle TOKEN_REFRESHED event correctly', async () => {
      authCallback?.('INITIAL_SESSION', mockSession);
      await new Promise((r) => setTimeout(r, 10));

      authCallback?.('TOKEN_REFRESHED', {
        ...mockSession,
        access_token: 'new-refreshed-token',
      });

      expect(service.currentSession()?.access_token).toBe('new-refreshed-token');
      expect(service.currentUser()?.id).toBe(mockUser.id);
    });
  });

  function mockUserSession(userId: string): Session {
    return {
      access_token: `token-${userId}`,
      refresh_token: `refresh-${userId}`,
      expires_in: 3600,
      token_type: 'bearer',
      user: {
        id: userId,
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
        email: `${userId}@domain.com`,
      },
    };
  }
});
