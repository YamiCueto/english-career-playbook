import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SENTENCE_PATTERNS } from '../../core/content/playbook-content';
import { SentencePattern } from '../../core/models/playbook.model';
import { PracticeStorageService } from '../../core/services/practice-storage.service';
import { PracticeAttempt } from '../../core/models/session.model';

interface ValidationResult {
  isValid: boolean;
  message: string;
  type: 'success' | 'warning' | 'error';
  hint?: string;
}

@Component({
  selector: 'app-practice',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './practice.component.html',
  styleUrls: ['./practice.component.css'],
})
export class PracticeComponent {
  private storage = inject(PracticeStorageService);

  readonly patterns: SentencePattern[] = SENTENCE_PATTERNS;
  selectedPattern: SentencePattern = this.patterns[0];

  userInput: string = '';
  validation: ValidationResult | null = null;
  attempts: PracticeAttempt[] = [];

  constructor() {
    this.refreshAttempts();
  }

  get placeholderText(): string {
    return 'e.g. ' + this.selectedPattern.examples[0];
  }

  selectPattern(pattern: SentencePattern): void {
    this.selectedPattern = pattern;
    this.userInput = '';
    this.validation = null;
    this.refreshAttempts();
  }

  insertVerb(verb: string): void {
    if (!this.userInput.trim()) {
      if (this.selectedPattern.id === 'pattern-e') {
        this.userInput = `${verb} `;
      } else {
        this.userInput = `I ${verb} `;
      }
    } else {
      this.userInput = `${this.userInput.trim()} ${verb} `;
    }
  }

  setExample(example: string): void {
    this.userInput = example;
    this.validation = null;
  }

  async evaluateSentence(): Promise<void> {
    const text = this.userInput.trim();
    if (!text) {
      this.validation = {
        isValid: false,
        message: 'Escribe una oración antes de evaluar.',
        type: 'warning',
      };
      return;
    }

    this.validation = null;
    const lower = text.toLowerCase();

    if (lower.includes('i living')) {
      const candidate: ValidationResult = {
        isValid: false,
        message: 'Detectado: "I living". En presente simple para hablar de dónde vives usa: "I live".',
        type: 'error',
        hint: 'Ejemplo: I live in Colombia with my family.',
      };
      await this.saveAttempt(false, candidate.message);
      this.validation = candidate;
      return;
    }

    if (lower.includes('i am full stack') || lower.includes('i am engineer')) {
      const candidate: ValidationResult = {
        isValid: false,
        message: 'Detectado: omisión de artículo profesional. En inglés debes decir: "I am a full stack engineer".',
        type: 'warning',
        hint: 'Recuerda: profesión singular siempre lleva "a" o "an".',
      };
      await this.saveAttempt(false, candidate.message);
      this.validation = candidate;
      return;
    }

    if (lower.includes('have') && (lower.includes('years old') || lower.includes('year old'))) {
      const candidate: ValidationResult = {
        isValid: false,
        message: 'Detectado: "I have ... years old". La edad en inglés se expresa con el verbo To Be: "I am ... years old".',
        type: 'error',
        hint: 'Ejemplo: I am 35 years old (o no es necesario mencionarla en la entrevista).',
      };
      await this.saveAttempt(false, candidate.message);
      this.validation = candidate;
      return;
    }

    if (lower.includes('repeat me')) {
      const candidate: ValidationResult = {
        isValid: false,
        message: 'Detectado: "repeat me". La fórmula profesional es: "Could you repeat that, please?"',
        type: 'error',
        hint: 'Usa frases de supervivencia corteses y precisas.',
      };
      await this.saveAttempt(false, candidate.message);
      this.validation = candidate;
      return;
    }

    if (lower.includes('listen me')) {
      const candidate: ValidationResult = {
        isValid: false,
        message: 'Detectado: "listen me". Para verificar el audio di: "Can you hear me?"',
        type: 'error',
        hint: 'Hear es percibir sonido; Listen es prestar atención deliberada.',
      };
      await this.saveAttempt(false, candidate.message);
      this.validation = candidate;
      return;
    }

    if (lower.includes('would like try')) {
      const candidate: ValidationResult = {
        isValid: false,
        message: 'Detectado: "would like try". "Would like" requiere infinitivo con "to": "I would like to try".',
        type: 'error',
        hint: 'Fórmula: I would like to + verb.',
      };
      await this.saveAttempt(false, candidate.message);
      this.validation = candidate;
      return;
    }

    const words = text.split(/\s+/);

    if (this.selectedPattern.id === 'pattern-a') {
      const startsWithSubject = /^i\s+/i.test(text) || /^we\s+/i.test(text);
      if (!startsWithSubject) {
        const candidate: ValidationResult = {
          isValid: false,
          message: 'El Patrón A inicia con el sujeto (por ejemplo "I" o "We") seguido de tu verbo de acción.',
          type: 'warning',
          hint: 'Prueba comenzando con: I work... o I live...',
        };
        await this.saveAttempt(false, candidate.message);
        this.validation = candidate;
        return;
      }
      if (words.length < 3) {
        const candidate: ValidationResult = {
          isValid: false,
          message: 'Tu oración necesita un complemento para comunicar la idea completa (sujeto + verbo + complemento).',
          type: 'warning',
          hint: 'Ejemplo: "I work with Java" (3 palabras) o "I live in Colombia" (4 palabras).',
        };
        await this.saveAttempt(false, candidate.message);
        this.validation = candidate;
        return;
      }
    } else if (this.selectedPattern.id === 'pattern-b') {
      const hasExperiencePhrase =
        lower.includes('have experience') ||
        lower.includes('have worked') ||
        lower.includes('specialize in');
      if (!hasExperiencePhrase) {
        const candidate: ValidationResult = {
          isValid: false,
          message: 'El Patrón B requiere expresar experiencia o especialización.',
          type: 'warning',
          hint: 'Usa: "I have experience with...", "I have worked on..." o "I specialize in...".',
        };
        await this.saveAttempt(false, candidate.message);
        this.validation = candidate;
        return;
      }
      if (words.length < 4) {
        const candidate: ValidationResult = {
          isValid: false,
          message: 'Completa la oración indicando la tecnología o proyecto.',
          type: 'warning',
          hint: 'Ejemplo: "I have experience with Spring Boot and Angular".',
        };
        await this.saveAttempt(false, candidate.message);
        this.validation = candidate;
        return;
      }
    } else if (this.selectedPattern.id === 'pattern-c') {
      const startsWithSubject = /^i\s+/i.test(text) || /^we\s+/i.test(text);
      if (!startsWithSubject) {
        const candidate: ValidationResult = {
          isValid: false,
          message: 'El Patrón C inicia con sujeto ("I" o "We") y una acción en pasado.',
          type: 'warning',
          hint: 'Ejemplo: "I modernized a legacy system".',
        };
        await this.saveAttempt(false, candidate.message);
        this.validation = candidate;
        return;
      }
      const hasPastVerb =
        /\b(modernized|developed|migrated|automated|implemented|designed|built|worked|created|led|fixed|helped|managed|configured|tested|wrote|set up)\b/i.test(
          text
        ) || /\w+ed\b/i.test(text);
      if (!hasPastVerb) {
        const candidate: ValidationResult = {
          isValid: false,
          message: 'Usa un verbo en tiempo pasado para narrar lo que lograste en el proyecto.',
          type: 'warning',
          hint: 'Verbos sugeridos: modernized, developed, migrated, automated, implemented, designed.',
        };
        await this.saveAttempt(false, candidate.message);
        this.validation = candidate;
        return;
      }
      if (words.length < 3) {
        const candidate: ValidationResult = {
          isValid: false,
          message: 'Describe la acción y el componente o logro alcanzado.',
          type: 'warning',
          hint: 'Ejemplo: "I developed the backend services".',
        };
        await this.saveAttempt(false, candidate.message);
        this.validation = candidate;
        return;
      }
    } else if (this.selectedPattern.id === 'pattern-d') {
      const hasIntent =
        lower.includes('want to') ||
        lower.includes('would like to') ||
        lower.includes('planning to') ||
        lower.includes('plan to') ||
        lower.includes('aim to');
      if (!hasIntent) {
        const candidate: ValidationResult = {
          isValid: false,
          message: 'El Patrón D requiere una expresión de intención o aspiración profesional.',
          type: 'warning',
          hint: 'Usa: "I want to...", "I would like to..." o "I am planning to...".',
        };
        await this.saveAttempt(false, candidate.message);
        this.validation = candidate;
        return;
      }
      if (words.length < 4) {
        const candidate: ValidationResult = {
          isValid: false,
          message: 'Completa la meta profesional después del verbo de intención.',
          type: 'warning',
          hint: 'Ejemplo: "I would like to work on global products".',
        };
        await this.saveAttempt(false, candidate.message);
        this.validation = candidate;
        return;
      }
    } else if (this.selectedPattern.id === 'pattern-e') {
      const startsWithQuestionWord =
        /^(could you|can you|would you|what|why|how|where|when|do you|are you)\b/i.test(
          text
        );
      if (!startsWithQuestionWord) {
        const candidate: ValidationResult = {
          isValid: false,
          message: 'El Patrón E debe iniciar con una fórmula o palabra interrogativa.',
          type: 'warning',
          hint: 'Inicia con: "Could you...", "What...", "Why..." o "How...".',
        };
        await this.saveAttempt(false, candidate.message);
        this.validation = candidate;
        return;
      }
      if (!text.endsWith('?')) {
        const candidate: ValidationResult = {
          isValid: false,
          message: 'Recuerda finalizar tu pregunta con el signo de interrogación de cierre "?".',
          type: 'warning',
          hint: 'Ejemplo: Could you tell me more about the team?',
        };
        await this.saveAttempt(false, candidate.message);
        this.validation = candidate;
        return;
      }
      if (words.length < 3) {
        const candidate: ValidationResult = {
          isValid: false,
          message: 'Formula una pregunta completa para clarificar o indagar.',
          type: 'warning',
          hint: 'Ejemplo: "Could you repeat the question, please?"',
        };
        await this.saveAttempt(false, candidate.message);
        this.validation = candidate;
        return;
      }
    }

    const candidate: ValidationResult = {
      isValid: true,
      message: '¡Excelente construcción! Cumple con la estructura del patrón sin los vicios habituales.',
      type: 'success',
      hint: 'Intenta decirla en voz alta tres veces con ritmo pausado y seguro.',
    };
    await this.saveAttempt(true, candidate.message);
    this.validation = candidate;
  }

  private async saveAttempt(isValid: boolean, feedback: string): Promise<void> {
    await this.storage.saveAttempt({
      patternId: this.selectedPattern.id,
      userInput: this.userInput.trim(),
      isValid,
      feedback,
    });
    this.refreshAttempts();
  }

  private refreshAttempts(): void {
    this.attempts = this.storage
      .getAttempts()
      .filter((a) => a.patternId === this.selectedPattern.id)
      .slice(0, 5);
  }
}
