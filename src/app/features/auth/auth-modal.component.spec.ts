import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthModalComponent } from './auth-modal.component';
import { SupabaseService } from '../../core/services/supabase.service';
import { AuthError, Session, User } from '@supabase/supabase-js';
import { SimpleChange } from '@angular/core';

describe('AuthModalComponent', () => {
  let component: AuthModalComponent;
  let fixture: ComponentFixture<AuthModalComponent>;
  let mockSupabaseService: Partial<SupabaseService>;

  const mockUser: User = {
    id: 'test-user-id',
    app_metadata: {},
    user_metadata: { full_name: 'Alex Morgan' },
    aud: 'authenticated',
    created_at: '2026-09-07T00:00:00Z',
  };

  const mockSession: Session = {
    access_token: 'valid-token',
    refresh_token: 'valid-refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: mockUser,
  };

  beforeEach(async () => {
    mockSupabaseService = {
      signIn: vi.fn().mockResolvedValue({ data: { user: mockUser, session: mockSession }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: mockUser, session: mockSession }, error: null }),
      authLoading: vi.fn().mockReturnValue(false) as any,
      authError: vi.fn().mockReturnValue(null) as any,
    };

    await TestBed.configureTestingModule({
      imports: [AuthModalComponent],
      providers: [
        { provide: SupabaseService, useValue: mockSupabaseService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthModalComponent);
    component = fixture.componentInstance;
    component.isOpen = true;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(component.mode()).toBe('signin');
  });

  it('should switch mode between signin and signup', () => {
    component.switchMode('signup');
    expect(component.mode()).toBe('signup');
    expect(component.errorMessage()).toBeNull();

    component.switchMode('signin');
    expect(component.mode()).toBe('signin');
  });

  it('should respond to ngOnChanges for isOpen and initialMode', () => {
    component.initialMode = 'signup';
    component.isOpen = true;
    component.ngOnChanges({
      isOpen: new SimpleChange(false, true, true),
      initialMode: new SimpleChange('signin', 'signup', true),
    });
    expect(component.mode()).toBe('signup');
    expect(component.showPassword()).toBe(false);
  });

  it('should validate signInForm controls correctly', () => {
    const form = component.signInForm;
    expect(form.valid).toBe(false);

    form.patchValue({ email: 'not-an-email', password: '123' });
    expect(form.get('email')?.valid).toBe(false);
    expect(form.get('password')?.valid).toBe(false);

    form.patchValue({ email: 'test@example.com', password: 'password123' });
    expect(form.valid).toBe(true);
  });

  it('should validate signUpForm controls and password matching', () => {
    const form = component.signUpForm;
    expect(form.valid).toBe(false);

    form.patchValue({
      displayName: 'Alex',
      email: 'alex@example.com',
      password: 'password123',
      confirmPassword: 'differentpassword',
    });
    expect(form.hasError('passwordMismatch')).toBe(true);
    expect(form.valid).toBe(false);

    form.patchValue({ confirmPassword: 'password123' });
    expect(form.hasError('passwordMismatch')).toBe(false);
    expect(form.valid).toBe(true);
  });

  it('should not call signIn when signInForm is invalid', async () => {
    await component.handleSignIn();
    expect(mockSupabaseService.signIn).not.toHaveBeenCalled();
    expect(component.signInForm.touched).toBe(true);
  });

  it('should call signIn with valid values and emit closed on success', async () => {
    const closeSpy = vi.spyOn(component.closed, 'emit');
    component.signInForm.patchValue({
      email: 'engineer@test.com',
      password: 'secretPassword',
    });

    await component.handleSignIn();

    expect(mockSupabaseService.signIn).toHaveBeenCalledWith('engineer@test.com', 'secretPassword');
    expect(closeSpy).toHaveBeenCalled();
    expect(component.errorMessage()).toBeNull();
  });

  it('should show translated error when signIn fails', async () => {
    const error = new AuthError('Invalid login credentials');
    (mockSupabaseService.signIn as any).mockResolvedValue({
      data: { user: null, session: null },
      error,
    });

    component.signInForm.patchValue({
      email: 'engineer@test.com',
      password: 'wrongPassword',
    });

    await component.handleSignIn();

    expect(component.errorMessage()).toContain('Credenciales incorrectas');
  });

  it('should call signUp with display name and emit closed when session is returned', async () => {
    const closeSpy = vi.spyOn(component.closed, 'emit');
    component.switchMode('signup');
    component.signUpForm.patchValue({
      displayName: 'Alex Morgan',
      email: 'alex@test.com',
      password: 'securePassword123',
      confirmPassword: 'securePassword123',
    });

    await component.handleSignUp();

    expect(mockSupabaseService.signUp).toHaveBeenCalledWith('alex@test.com', 'securePassword123', 'Alex Morgan');
    expect(closeSpy).toHaveBeenCalled();
  });

  it('should show email confirmation view when signUp succeeds without session', async () => {
    (mockSupabaseService.signUp as any).mockResolvedValue({
      data: { user: mockUser, session: null },
      error: null,
    });

    component.switchMode('signup');
    component.signUpForm.patchValue({
      displayName: '',
      email: 'confirm-me@test.com',
      password: 'securePassword123',
      confirmPassword: 'securePassword123',
    });

    await component.handleSignUp();

    expect(mockSupabaseService.signUp).toHaveBeenCalledWith('confirm-me@test.com', 'securePassword123', undefined);
    expect(component.emailConfirmationSent()).toBe('confirm-me@test.com');
  });

  it('should show translated error when signUp email already exists', async () => {
    const error = new AuthError('User already registered');
    (mockSupabaseService.signUp as any).mockResolvedValue({
      data: { user: null, session: null },
      error,
    });

    component.switchMode('signup');
    component.signUpForm.patchValue({
      email: 'existing@test.com',
      password: 'securePassword123',
      confirmPassword: 'securePassword123',
    });

    await component.handleSignUp();

    expect(component.errorMessage()).toContain('ya está registrado');
  });

  it('should toggle password and confirm password visibility', () => {
    expect(component.showPassword()).toBe(false);
    component.togglePasswordVisibility();
    expect(component.showPassword()).toBe(true);
    component.togglePasswordVisibility();
    expect(component.showPassword()).toBe(false);

    expect(component.showConfirmPassword()).toBe(false);
    component.toggleConfirmPasswordVisibility();
    expect(component.showConfirmPassword()).toBe(true);
  });

  it('should close on escape key when open', () => {
    const closeSpy = vi.spyOn(component.closed, 'emit');
    component.handleEscape();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('should close on backdrop click', () => {
    const closeSpy = vi.spyOn(component.closed, 'emit');
    const backdropElement = document.createElement('div');
    const fakeEvent = {
      target: backdropElement,
      currentTarget: backdropElement,
    } as unknown as MouseEvent;

    component.onBackdropClick(fakeEvent);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('should lock and unlock body scroll on open and close', () => {
    component.isOpen = true;
    component.ngOnChanges({
      isOpen: new SimpleChange(false, true, false),
    });
    expect(document.body.style.overflow).toBe('hidden');

    component.close();
    expect(document.body.style.overflow).toBe('');
  });

  it('should trap focus within the modal card on Tab keydown', () => {
    const card = fixture.nativeElement.querySelector('.auth-modal-card');
    const buttons = card.querySelectorAll('button, input');
    const firstElement = buttons[0] as HTMLElement;
    const lastElement = buttons[buttons.length - 1] as HTMLElement;

    firstElement.focus();
    const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(shiftTabEvent, 'preventDefault');

    component.handleKeyDown(shiftTabEvent);
    expect(preventDefaultSpy).toHaveBeenCalled();

    lastElement.focus();
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, cancelable: true });
    const tabPreventSpy = vi.spyOn(tabEvent, 'preventDefault');

    component.handleKeyDown(tabEvent);
    expect(tabPreventSpy).toHaveBeenCalled();
  });

  it('should translate network and generic errors without exposing technical internals', async () => {
    (mockSupabaseService.signIn as any).mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthError('Failed to fetch from host: timeout'),
    });

    component.signInForm.patchValue({ email: 'test@domain.com', password: 'password123' });
    await component.handleSignIn();
    expect(component.errorMessage()).toContain('conectar con el servidor');

    (mockSupabaseService.signIn as any).mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthError('PGRST301: Internal database error details 500'),
    });

    await component.handleSignIn();
    expect(component.errorMessage()).not.toContain('PGRST301');
    expect(component.errorMessage()).toContain('No se pudo completar la operación');
  });

  it('should discard late signIn response if modal was closed before request completed', async () => {
    let resolveSignIn!: (val: any) => void;
    (mockSupabaseService.signIn as any).mockReturnValue(
      new Promise((res) => {
        resolveSignIn = res;
      })
    );

    component.signInForm.patchValue({ email: 'late@domain.com', password: 'password123' });
    const pendingPromise = component.handleSignIn();

    component.close();

    resolveSignIn({
      data: { user: null, session: null },
      error: new AuthError('Invalid login credentials'),
    });

    await pendingPromise;
    expect(component.errorMessage()).toBeNull();
  });

  it('should discard late signUp response if modal was closed before request completed', async () => {
    let resolveSignUp!: (val: any) => void;
    (mockSupabaseService.signUp as any).mockReturnValue(
      new Promise((res) => {
        resolveSignUp = res;
      })
    );

    component.switchMode('signup');
    component.signUpForm.patchValue({
      email: 'late@domain.com',
      password: 'password123',
      confirmPassword: 'password123',
    });
    const pendingPromise = component.handleSignUp();

    component.close();

    resolveSignUp({
      data: { user: mockUser, session: null },
      error: null,
    });

    await pendingPromise;
    expect(component.emailConfirmationSent()).toBeNull();
  });

  it('should clean up scroll lock and timers on destroy', () => {
    component.isOpen = true;
    component.ngOnChanges({
      isOpen: new SimpleChange(false, true, true),
    });
    expect(document.body.style.overflow).toBe('hidden');

    component.ngOnDestroy();
    expect(document.body.style.overflow).toBe('');
  });
});
