import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal,
  inject,
  HostListener,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';

function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  if (!confirm) {
    return null;
  }
  return password === confirm ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './auth-modal.component.html',
  styleUrl: './auth-modal.component.css',
})
export class AuthModalComponent implements OnChanges, OnDestroy {
  private fb = inject(FormBuilder);
  private elementRef = inject(ElementRef);
  public supabaseService = inject(SupabaseService);

  @Input() isOpen = false;
  @Input() initialMode: 'signin' | 'signup' = 'signin';
  @Output() closed = new EventEmitter<void>();

  private previousActiveElement: HTMLElement | null = null;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private operationGeneration = 0;

  readonly mode = signal<'signin' | 'signup'>('signin');
  readonly showPassword = signal<boolean>(false);
  readonly showConfirmPassword = signal<boolean>(false);
  readonly emailConfirmationSent = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);

  readonly signInForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  readonly signUpForm: FormGroup = this.fb.group(
    {
      displayName: ['', [Validators.maxLength(100)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordMatchValidator }
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      if (this.isOpen) {
        this.clearFocusTimer();
        ++this.operationGeneration;
        this.previousActiveElement = (document.activeElement as HTMLElement) || null;
        document.body.style.overflow = 'hidden';
        this.mode.set(this.initialMode);
        this.errorMessage.set(null);
        this.emailConfirmationSent.set(null);
        this.showPassword.set(false);
        this.showConfirmPassword.set(false);
        this.scheduleInitialFocus();
      } else {
        this.clearFocusTimer();
        ++this.operationGeneration;
        document.body.style.overflow = '';
        this.restorePreviousFocus();
      }
    }
    if (changes['initialMode'] && changes['initialMode'].currentValue) {
      this.mode.set(this.initialMode);
    }
  }

  ngOnDestroy(): void {
    this.clearFocusTimer();
    ++this.operationGeneration;
    document.body.style.overflow = '';
    this.restorePreviousFocus();
  }

  @HostListener('window:keydown.escape')
  handleEscape(): void {
    if (this.isOpen) {
      this.close();
    }
  }

  @HostListener('keydown', ['$event'])
  handleKeyDown(event: Event): void {
    if (!this.isOpen) {
      return;
    }
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.key === 'Tab') {
      this.trapFocus(keyEvent);
    }
  }

  private trapFocus(event: KeyboardEvent): void {
    const card = this.elementRef.nativeElement.querySelector('.auth-modal-card') as HTMLElement | null;
    if (!card) {
      return;
    }

    const focusable = card.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first || !card.contains(document.activeElement)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !card.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  private scheduleInitialFocus(): void {
    this.clearFocusTimer();
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      if (!this.isOpen) {
        return;
      }
      this.focusInitialElement();
    }, 50);
  }

  private clearFocusTimer(): void {
    if (this.focusTimer !== null) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
  }

  private focusInitialElement(): void {
    if (!this.isOpen) {
      return;
    }
    const card = this.elementRef.nativeElement.querySelector('.auth-modal-card') as HTMLElement | null;
    if (!card) {
      return;
    }
    const targetInput = card.querySelector<HTMLElement>('.form-input:not([disabled])');
    if (targetInput) {
      targetInput.focus();
    } else {
      const activeTab = card.querySelector<HTMLElement>('.tab-btn.active');
      activeTab?.focus();
    }
  }

  private restorePreviousFocus(): void {
    this.clearFocusTimer();
    const elementToFocus = this.previousActiveElement;
    this.previousActiveElement = null;
    if (elementToFocus && typeof elementToFocus.focus === 'function') {
      queueMicrotask(() => {
        elementToFocus.focus();
      });
    }
  }

  switchMode(target: 'signin' | 'signup'): void {
    this.clearFocusTimer();
    ++this.operationGeneration;
    this.mode.set(target);
    this.errorMessage.set(null);
    this.emailConfirmationSent.set(null);
    this.scheduleInitialFocus();
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((val) => !val);
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((val) => !val);
  }

  close(): void {
    this.clearFocusTimer();
    ++this.operationGeneration;
    document.body.style.overflow = '';
    this.restorePreviousFocus();
    this.errorMessage.set(null);
    this.emailConfirmationSent.set(null);
    this.signInForm.reset();
    this.signUpForm.reset();
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  async handleSignIn(): Promise<void> {
    if (this.signInForm.invalid) {
      this.signInForm.markAllAsTouched();
      return;
    }

    const opId = ++this.operationGeneration;
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const { email, password } = this.signInForm.value;

    try {
      const result = await this.supabaseService.signIn(email, password);
      if (this.operationGeneration !== opId || !this.isOpen) {
        return;
      }
      if (result.error) {
        this.errorMessage.set(this.translateAuthError(result.error.message));
        return;
      }
      this.close();
    } catch {
      if (this.operationGeneration !== opId || !this.isOpen) {
        return;
      }
      this.errorMessage.set('No se pudo conectar con el servidor. Por favor intenta de nuevo.');
    } finally {
      if (this.operationGeneration === opId) {
        this.isSubmitting.set(false);
      }
    }
  }

  async handleSignUp(): Promise<void> {
    if (this.signUpForm.invalid) {
      this.signUpForm.markAllAsTouched();
      return;
    }

    const opId = ++this.operationGeneration;
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const { email, password, displayName } = this.signUpForm.value;
    const nameToSubmit = displayName && displayName.trim().length > 0 ? displayName.trim() : undefined;

    try {
      const result = await this.supabaseService.signUp(email, password, nameToSubmit);
      if (this.operationGeneration !== opId || !this.isOpen) {
        return;
      }
      if (result.error) {
        this.errorMessage.set(this.translateAuthError(result.error.message));
        return;
      }

      if (result.data?.session) {
        this.close();
      } else {
        this.emailConfirmationSent.set(email);
      }
    } catch {
      if (this.operationGeneration !== opId || !this.isOpen) {
        return;
      }
      this.errorMessage.set('No se pudo conectar con el servidor. Por favor intenta de nuevo.');
    } finally {
      if (this.operationGeneration === opId) {
        this.isSubmitting.set(false);
      }
    }
  }

  private translateAuthError(message: string): string {
    const lower = (message || '').toLowerCase();
    if (
      lower.includes('invalid login credentials') ||
      lower.includes('invalid_grant') ||
      lower.includes('invalid_credentials') ||
      (lower.includes('invalid') && lower.includes('password'))
    ) {
      return 'Credenciales incorrectas. Verifica tu correo y contraseña.';
    }
    if (
      lower.includes('already registered') ||
      lower.includes('already exists') ||
      lower.includes('user_already_exists')
    ) {
      return 'Este correo electrónico ya está registrado. Inicia sesión en su lugar.';
    }
    if (
      lower.includes('least 6') ||
      lower.includes('too short') ||
      lower.includes('weak_password') ||
      (lower.includes('password') && lower.includes('short'))
    ) {
      return 'La contraseña debe contener al menos 6 caracteres.';
    }
    if (lower.includes('not confirmed') || lower.includes('unconfirmed')) {
      return 'Tu correo no ha sido confirmado aún. Revisa tu bandeja de entrada.';
    }
    if (
      lower.includes('network') ||
      lower.includes('failed to fetch') ||
      lower.includes('fetch failed') ||
      lower.includes('timeout') ||
      lower.includes('offline')
    ) {
      return 'No se pudo conectar con el servidor. Verifica tu conexión a internet.';
    }
    if (lower.includes('not configured') || lower.includes('no configurado')) {
      return 'Servicio de autenticación no disponible en este momento.';
    }
    return 'No se pudo completar la operación. Por favor intenta de nuevo en unos momentos.';
  }
}
