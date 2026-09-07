import { Component, inject, signal, computed, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { SupabaseService } from './core/services/supabase.service';
import { AuthModalComponent } from './features/auth/auth-modal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, AuthModalComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class App {
  private elementRef = inject(ElementRef);
  public supabaseService = inject(SupabaseService);

  protected readonly title = 'English Career Playbook';

  readonly isAuthModalOpen = signal<boolean>(false);
  readonly authModalMode = signal<'signin' | 'signup'>('signin');
  readonly isUserMenuOpen = signal<boolean>(false);

  readonly userInitials = computed(() => {
    const profile = this.supabaseService.currentProfile();
    const user = this.supabaseService.currentUser();
    const name = profile?.display_name || (user?.user_metadata?.['full_name'] as string) || (user?.user_metadata?.['name'] as string) || '';
    if (name.trim()) {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return 'U';
  });

  readonly userDisplayName = computed(() => {
    const profile = this.supabaseService.currentProfile();
    const user = this.supabaseService.currentUser();
    return (
      profile?.display_name ||
      (user?.user_metadata?.['full_name'] as string) ||
      (user?.user_metadata?.['name'] as string) ||
      user?.email?.split('@')[0] ||
      'Usuario'
    );
  });

  readonly userEmail = computed(() => {
    return this.supabaseService.currentUser()?.email || '';
  });

  readonly connectionStatus = computed<'authenticated' | 'error' | 'guest'>(() => {
    if (this.supabaseService.restorationError() || this.supabaseService.profileError()) {
      return 'error';
    }
    if (this.supabaseService.isAuthenticated) {
      return 'authenticated';
    }
    return 'guest';
  });

  readonly connectionLabel = computed<string>(() => {
    switch (this.connectionStatus()) {
      case 'authenticated':
        return 'Sesión Activa';
      case 'error':
        return 'Sin Conexión';
      case 'guest':
      default:
        return 'Modo Invitado';
    }
  });

  openAuthModal(mode: 'signin' | 'signup' = 'signin'): void {
    this.authModalMode.set(mode);
    this.isAuthModalOpen.set(true);
    this.isUserMenuOpen.set(false);
  }

  closeAuthModal(): void {
    this.isAuthModalOpen.set(false);
  }

  toggleUserMenu(): void {
    this.isUserMenuOpen.update((v) => !v);
  }

  closeUserMenu(): void {
    this.isUserMenuOpen.set(false);
  }

  async handleSignOut(): Promise<void> {
    this.closeUserMenu();
    await this.supabaseService.signOut();
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent): void {
    if (!this.isUserMenuOpen()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const clickedInside = target && this.elementRef.nativeElement.querySelector('.user-menu-wrapper')?.contains(target);
    if (!clickedInside) {
      this.closeUserMenu();
    }
  }

  @HostListener('window:keydown.escape')
  handleEscape(): void {
    if (this.isAuthModalOpen()) {
      return;
    }
    if (this.isUserMenuOpen()) {
      this.closeUserMenu();
    }
  }
}
