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

  selectPattern(pattern: SentencePattern): void {
    this.selectedPattern = pattern;
    this.userInput = '';
    this.validation = null;
    this.refreshAttempts();
  }

  insertVerb(verb: string): void {
    if (!this.userInput.trim()) {
      this.userInput = `I ${verb} `;
    } else {
      this.userInput = `${this.userInput.trim()} ${verb} `;
    }
  }

  setExample(example: string): void {
    this.userInput = example;
    this.validation = null;
  }

  evaluateSentence(): void {
    const text = this.userInput.trim();
    if (!text) {
      this.validation = {
        isValid: false,
        message: 'Escribe una oración antes de evaluar.',
        type: 'warning',
      };
      return;
    }

    const lower = text.toLowerCase();

    // 1. Diagnóstico de errores documentados en el Playbook
    if (lower.includes('i living')) {
      this.validation = {
        isValid: false,
        message: 'Detectado: "I living". En presente simple para hablar de dónde vives usa: "I live".',
        type: 'error',
        hint: 'Ejemplo: I live in Colombia with my family.',
      };
      this.saveAttempt(false, this.validation.message);
      return;
    }

    if (lower.includes('i am full stack') || lower.includes('i am engineer')) {
      this.validation = {
        isValid: false,
        message: 'Detectado: omisión de artículo profesional. En inglés debes decir: "I am a full stack engineer".',
        type: 'warning',
        hint: 'Recuerda: profesión singular siempre lleva "a" o "an".',
      };
      this.saveAttempt(false, this.validation.message);
      return;
    }

    if (lower.includes('have') && (lower.includes('years old') || lower.includes('year old'))) {
      this.validation = {
        isValid: false,
        message: 'Detectado: "I have ... years old". La edad en inglés se expresa con el verbo To Be: "I am ... years old".',
        type: 'error',
        hint: 'Ejemplo: I am 35 years old (o no es necesario mencionarla en la entrevista).',
      };
      this.saveAttempt(false, this.validation.message);
      return;
    }

    if (lower.includes('repeat me')) {
      this.validation = {
        isValid: false,
        message: 'Detectado: "repeat me". La fórmula profesional es: "Could you repeat that, please?"',
        type: 'error',
        hint: 'Usa frases de supervivencia corteses y precisas.',
      };
      this.saveAttempt(false, this.validation.message);
      return;
    }

    if (lower.includes('listen me')) {
      this.validation = {
        isValid: false,
        message: 'Detectado: "listen me". Para verificar el audio di: "Can you hear me?"',
        type: 'error',
        hint: 'Hear es percibir sonido; Listen es prestar atención deliberada.',
      };
      this.saveAttempt(false, this.validation.message);
      return;
    }

    if (lower.includes('would like try')) {
      this.validation = {
        isValid: false,
        message: 'Detectado: "would like try". "Would like" requiere infinitivo con "to": "I would like to try".',
        type: 'error',
        hint: 'Fórmula: I would like to + verb.',
      };
      this.saveAttempt(false, this.validation.message);
      return;
    }

    // 2. Validación de estructura para el Patrón A (Sujeto + Verbo + Complemento)
    if (this.selectedPattern.id === 'pattern-a') {
      const startsWithSubject = /^i\s+/i.test(text) || /^we\s+/i.test(text);
      if (!startsWithSubject) {
        this.validation = {
          isValid: false,
          message: 'El Patrón A inicia con el sujeto (por ejemplo "I" o "We") seguido de tu verbo de acción.',
          type: 'warning',
          hint: 'Prueba comenzando con: I work... o I live...',
        };
        this.saveAttempt(false, this.validation.message);
        return;
      }

      const words = text.split(/\s+/);
      if (words.length < 3) {
        this.validation = {
          isValid: false,
          message: 'Tu oración necesita un complemento para comunicar la idea completa (sujeto + verbo + complemento).',
          type: 'warning',
          hint: 'Ejemplo: "I work with Java" (3 palabras) o "I live in Colombia" (4 palabras).',
        };
        this.saveAttempt(false, this.validation.message);
        return;
      }
    }

    // Aprobado
    this.validation = {
      isValid: true,
      message: '¡Excelente construcción! Cumple con la estructura del patrón sin los vicios habituales.',
      type: 'success',
      hint: 'Intenta decirla en voz alta tres veces con ritmo pausado y seguro.',
    };
    this.saveAttempt(true, this.validation.message);
  }

  private saveAttempt(isValid: boolean, feedback: string): void {
    this.storage.saveAttempt({
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
