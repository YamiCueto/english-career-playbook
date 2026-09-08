import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GuestClaimModalComponent } from './guest-claim-modal.component';
import { GuestClaimService } from '../../core/services/guest-claim.service';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaimCheckpoint, GuestClaimSummary } from '../../core/models/guest-claim.model';

describe('GuestClaimModalComponent', () => {
  let component: GuestClaimModalComponent;
  let fixture: ComponentFixture<GuestClaimModalComponent>;
  let mockClaimService: any;

  const isVisibleSignal = signal<boolean>(true);
  const isProcessingSignal = signal<boolean>(false);
  const errorSignal = signal<string | null>(null);
  const checkpointSignal = signal<ClaimCheckpoint | null>(null);

  const sampleSummary: GuestClaimSummary = {
    sessionsCount: 3,
    attemptsCount: 12,
    evaluationsCount: 2,
    fingerprint: 'fp-123',
    hasOrphans: false,
    orphanCount: 0,
  };

  beforeEach(async () => {
    isVisibleSignal.set(true);
    isProcessingSignal.set(false);
    errorSignal.set(null);
    checkpointSignal.set(null);

    mockClaimService = {
      isClaimPromptVisible: isVisibleSignal,
      isProcessing: isProcessingSignal,
      claimError: errorSignal,
      activeCheckpoint: checkpointSignal,
      getGuestSummary: vi.fn().mockReturnValue(sampleSummary),
      claim: vi.fn().mockResolvedValue(true),
      keepSeparate: vi.fn(),
      postpone: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [GuestClaimModalComponent],
      providers: [
        { provide: GuestClaimService, useValue: mockClaimService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GuestClaimModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates component successfully', () => {
    expect(component).toBeTruthy();
  });

  it('renders summary metrics correctly', () => {
    const values = fixture.nativeElement.querySelectorAll('.metric-value');
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(values[0].textContent.trim()).toBe('3');
    expect(values[1].textContent.trim()).toBe('12');
  });

  it('calls claimService.claim when primary button is clicked', async () => {
    const primaryBtn = fixture.nativeElement.querySelector('.claim-primary-btn');
    expect(primaryBtn).toBeTruthy();

    primaryBtn.click();
    fixture.detectChanges();

    expect(mockClaimService.claim).toHaveBeenCalled();
  });

  it('calls claimService.keepSeparate when secondary button is clicked', () => {
    const secondaryBtn = fixture.nativeElement.querySelector('.claim-secondary-btn');
    expect(secondaryBtn).toBeTruthy();

    secondaryBtn.click();
    fixture.detectChanges();

    expect(mockClaimService.keepSeparate).toHaveBeenCalled();
  });

  it('calls claimService.postpone when tertiary button is clicked', () => {
    const tertiaryBtn = fixture.nativeElement.querySelector('.claim-tertiary-btn');
    expect(tertiaryBtn).toBeTruthy();

    tertiaryBtn.click();
    fixture.detectChanges();

    expect(mockClaimService.postpone).toHaveBeenCalled();
  });

  it('calls postpone on escape key when not processing', () => {
    component.handleEscape();
    expect(mockClaimService.postpone).toHaveBeenCalled();
  });

  it('does not postpone on escape key when processing', () => {
    isProcessingSignal.set(true);
    fixture.detectChanges();

    component.handleEscape();
    expect(mockClaimService.postpone).not.toHaveBeenCalled();
  });

  it('shows processing indicator and disables buttons when processing', () => {
    isProcessingSignal.set(true);
    checkpointSignal.set('REMOTE_VERIFIED');
    fixture.detectChanges();

    const indicator = fixture.nativeElement.querySelector('.processing-indicator');
    expect(indicator).toBeTruthy();
    expect(indicator.textContent).toContain('Verificando persistencia remota segura');

    const primaryBtn = fixture.nativeElement.querySelector('.claim-primary-btn');
    expect(primaryBtn.disabled).toBe(true);
  });

  it('shows error banner when error signal is populated', () => {
    errorSignal.set('Network timeout during sync');
    fixture.detectChanges();

    const errorBanner = fixture.nativeElement.querySelector('.error-banner');
    expect(errorBanner).toBeTruthy();
    expect(errorBanner.textContent).toContain('Network timeout during sync');
  });

  it('includes accessibility attributes on modal card', () => {
    const card = fixture.nativeElement.querySelector('.claim-modal-card');
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(card.getAttribute('aria-labelledby')).toBe('claim-modal-title');
  });
});
