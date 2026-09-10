import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PracticeComponent } from './practice.component';
import { PracticeStorageService } from '../../core/services/practice-storage.service';

describe('PracticeComponent', () => {
  let component: PracticeComponent;
  let fixture: ComponentFixture<PracticeComponent>;
  let storage: PracticeStorageService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [PracticeComponent],
      providers: [PracticeStorageService],
    }).compileComponents();

    fixture = TestBed.createComponent(PracticeComponent);
    component = fixture.componentInstance;
    storage = TestBed.inject(PracticeStorageService);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should format placeholder dynamically for selected pattern', () => {
    expect(component.placeholderText).toContain('I work with Java');
    component.selectPattern(component.patterns[1]);
    expect(component.placeholderText).toContain('I have experience');
  });

  it('should insert verb for Pattern A with subject prefix', () => {
    component.insertVerb('develop');
    expect(component.userInput).toBe('I develop ');
  });

  it('should insert verb for Pattern E without subject prefix', () => {
    component.selectPattern(component.patterns[4]);
    component.insertVerb('Could you clarify');
    expect(component.userInput).toBe('Could you clarify ');
  });

  it('should diagnose "I living" mistake', async () => {
    component.userInput = 'I living in Colombia';
    await component.evaluateSentence();
    expect(component.validation?.isValid).toBe(false);
    expect(component.validation?.message).toContain('I living');
  });

  it('should diagnose missing article in profession', async () => {
    component.userInput = 'I am full stack engineer';
    await component.evaluateSentence();
    expect(component.validation?.isValid).toBe(false);
    expect(component.validation?.message).toContain('omisión de artículo profesional');
  });

  it('should validate valid Pattern A sentence and save attempt', async () => {
    component.userInput = 'I develop scalable backend APIs';
    await component.evaluateSentence();
    expect(component.validation?.isValid).toBe(true);
    expect(component.attempts.length).toBe(1);
    expect(component.attempts[0].isValid).toBe(true);
  });

  it('should validate Pattern B experience phrase requirement', async () => {
    component.selectPattern(component.patterns[1]);
    component.userInput = 'I like pizza today';
    await component.evaluateSentence();
    expect(component.validation?.isValid).toBe(false);

    component.userInput = 'I have experience developing microservices with Spring';
    await component.evaluateSentence();
    expect(component.validation?.isValid).toBe(true);
  });

  it('should validate Pattern C past tense verb requirement', async () => {
    component.selectPattern(component.patterns[2]);
    component.userInput = 'I build the service';
    await component.evaluateSentence();
    expect(component.validation?.isValid).toBe(false);

    component.userInput = 'I modernized a legacy banking system';
    await component.evaluateSentence();
    expect(component.validation?.isValid).toBe(true);
  });

  it('should validate Pattern D intent requirement', async () => {
    component.selectPattern(component.patterns[3]);
    component.userInput = 'I code every single day';
    await component.evaluateSentence();
    expect(component.validation?.isValid).toBe(false);

    component.userInput = 'I would like to work on global technology products';
    await component.evaluateSentence();
    expect(component.validation?.isValid).toBe(true);
  });

  it('should validate Pattern E question punctuation and starter', async () => {
    component.selectPattern(component.patterns[4]);
    component.userInput = 'Could you repeat the question';
    await component.evaluateSentence();
    expect(component.validation?.isValid).toBe(false);
    expect(component.validation?.message).toContain('?');

    component.userInput = 'Could you repeat the question, please?';
    await component.evaluateSentence();
    expect(component.validation?.isValid).toBe(true);
  });

  it('should not publish success feedback when storage persistence fails with quota error', async () => {
    vi.spyOn(storage, 'saveAttempt').mockRejectedValue(new Error('QuotaExceededError'));
    component.userInput = 'I develop scalable backend APIs';
    await expect(component.evaluateSentence()).rejects.toThrow('QuotaExceededError');
    expect(component.validation).toBeNull();
  });

  it('should await storage persistence before publishing validation feedback', async () => {
    let resolveStorage!: (value: any) => void;
    const storagePromise = new Promise<any>((resolve) => {
      resolveStorage = resolve;
    });
    vi.spyOn(storage, 'saveAttempt').mockReturnValue(storagePromise);

    component.userInput = 'I develop scalable backend APIs';
    const evalPromise = component.evaluateSentence();

    expect(component.validation).toBeNull();

    resolveStorage({
      id: 'test-id',
      patternId: 'pattern-a',
      userInput: component.userInput,
      isValid: true,
      feedback: 'ok',
      timestamp: new Date().toISOString(),
      syncStatus: 'pending',
    });
    await evalPromise;

    expect(component.validation?.isValid).toBe(true);
  });
});
