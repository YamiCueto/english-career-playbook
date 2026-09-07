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

  it('should diagnose "I living" mistake', () => {
    component.userInput = 'I living in Colombia';
    component.evaluateSentence();
    expect(component.validation?.isValid).toBe(false);
    expect(component.validation?.message).toContain('I living');
  });

  it('should diagnose missing article in profession', () => {
    component.userInput = 'I am full stack engineer';
    component.evaluateSentence();
    expect(component.validation?.isValid).toBe(false);
    expect(component.validation?.message).toContain('omisión de artículo profesional');
  });

  it('should validate valid Pattern A sentence and save attempt', () => {
    component.userInput = 'I develop scalable backend APIs';
    component.evaluateSentence();
    expect(component.validation?.isValid).toBe(true);
    expect(component.attempts.length).toBe(1);
    expect(component.attempts[0].isValid).toBe(true);
  });

  it('should validate Pattern B experience phrase requirement', () => {
    component.selectPattern(component.patterns[1]);
    component.userInput = 'I like pizza today';
    component.evaluateSentence();
    expect(component.validation?.isValid).toBe(false);

    component.userInput = 'I have experience developing microservices with Spring';
    component.evaluateSentence();
    expect(component.validation?.isValid).toBe(true);
  });

  it('should validate Pattern C past tense verb requirement', () => {
    component.selectPattern(component.patterns[2]);
    component.userInput = 'I build the service';
    component.evaluateSentence();
    expect(component.validation?.isValid).toBe(false);

    component.userInput = 'I modernized a legacy banking system';
    component.evaluateSentence();
    expect(component.validation?.isValid).toBe(true);
  });

  it('should validate Pattern D intent requirement', () => {
    component.selectPattern(component.patterns[3]);
    component.userInput = 'I code every single day';
    component.evaluateSentence();
    expect(component.validation?.isValid).toBe(false);

    component.userInput = 'I would like to work on global technology products';
    component.evaluateSentence();
    expect(component.validation?.isValid).toBe(true);
  });

  it('should validate Pattern E question punctuation and starter', () => {
    component.selectPattern(component.patterns[4]);
    component.userInput = 'Could you repeat the question';
    component.evaluateSentence();
    expect(component.validation?.isValid).toBe(false);
    expect(component.validation?.message).toContain('?');

    component.userInput = 'Could you repeat the question, please?';
    component.evaluateSentence();
    expect(component.validation?.isValid).toBe(true);
  });
});
