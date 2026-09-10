import { Component, inject, computed, HostListener, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GuestClaimService } from '../../core/services/guest-claim.service';

@Component({
  selector: 'app-guest-claim-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './guest-claim-modal.component.html',
  styleUrl: './guest-claim-modal.component.css',
})
export class GuestClaimModalComponent implements AfterViewInit {
  public claimService = inject(GuestClaimService);
  private elementRef = inject(ElementRef);

  @ViewChild('primaryActionBtn') primaryActionBtn?: ElementRef<HTMLButtonElement>;

  readonly summary = computed(() => this.claimService.getGuestSummary());
  readonly isVisible = this.claimService.isClaimPromptVisible;
  readonly isProcessing = this.claimService.isProcessing;
  readonly error = this.claimService.claimError;
  readonly checkpoint = this.claimService.activeCheckpoint;

  readonly statusMessage = computed(() => {
    switch (this.checkpoint()) {
      case 'SNAPSHOT_CAPTURED':
        return 'Guardando instantánea de respaldo...';
      case 'LOCAL_MERGED':
        return 'Integrando datos a tu cuenta local...';
      case 'ENQUEUED':
        return 'Encolando registros para sincronización...';
      case 'REMOTE_VERIFIED':
        return 'Verificando persistencia remota segura...';
      case 'PARTIALLY_VERIFIED':
        return 'Sincronización parcial. Algunos registros permanecen en tu equipo.';
      case 'COMPLETED':
        return '¡Progreso transferido con éxito!';
      default:
        return 'Procesando transferencia...';
    }
  });

  ngAfterViewInit(): void {
    if (this.isVisible()) {
      this.focusPrimary();
    }
  }

  async handleClaim(): Promise<void> {
    await this.claimService.claim();
  }

  handleKeepSeparate(): void {
    this.claimService.keepSeparate();
  }

  handlePostpone(): void {
    this.claimService.postpone();
  }

  @HostListener('window:keydown.escape')
  handleEscape(): void {
    if (this.isVisible() && !this.isProcessing()) {
      this.handlePostpone();
    }
  }

  private focusPrimary(): void {
    setTimeout(() => {
      this.primaryActionBtn?.nativeElement?.focus();
    }, 50);
  }
}
