import { TestBed } from '@angular/core/testing';
import { PracticeStorageService } from './practice-storage.service';

describe('PracticeStorageService', () => {
  let service: PracticeStorageService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(PracticeStorageService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should save and retrieve attempts locally', () => {
    const attempt = service.saveAttempt({
      patternId: 'pattern-a',
      userInput: 'I work with Angular',
      isValid: true,
      feedback: 'Good job',
    });

    expect(attempt.id).toBeDefined();
    const attempts = service.getAttempts();
    expect(attempts.length).toBe(1);
    expect(attempts[0].userInput).toBe('I work with Angular');
  });
});
