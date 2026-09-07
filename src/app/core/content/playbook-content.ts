import { LearningPhase, SentencePattern, VocabularyWord, InterviewQuestionItem } from '../models/playbook.model';

export const LEARNING_PHASES: LearningPhase[] = [
  {
    phaseNumber: 1,
    title: 'Base personal y construcción de oraciones',
    description: 'Presentaciones, familia, ciudad, rutina, presente simple y continuo, artículos y preguntas básicas.',
    focusTopics: ['Presente simple', 'Artículos a / an / the', 'Estructura Sujeto + Verbo + Complemento'],
  },
  {
    phaseNumber: 2,
    title: 'Historia y experiencia',
    description: 'Pasado simple, presente perfecto, conectores temporales, proyectos y logros cronológicos.',
    focusTopics: ['Verbos en pasado', 'Presente perfecto (have worked)', 'Conectores narrativos'],
  },
  {
    phaseNumber: 3,
    title: 'Inglés técnico de ingeniería',
    description: 'Java, Spring Boot, Angular, TypeScript, SQL, APIs REST, arquitectura, pruebas y AWS.',
    focusTopics: ['Vocabulario de arquitectura', 'Explicación de componentes', 'Infraestructura y CI/CD'],
  },
  {
    phaseNumber: 4,
    title: 'Inglés profesional y trabajo diario',
    description: 'Daily standups, refinamiento de historias, estimaciones, code reviews, incidentes y colaboración.',
    focusTopics: ['Estatus diario', 'Desacuerdos constructivos', 'Reporte de bloqueos'],
  },
  {
    phaseNumber: 5,
    title: 'Entrevistas internacionales',
    description: 'Elevator pitch, preguntas conductuales con método STAR, diseño de sistemas y motivación.',
    focusTopics: ['Storytelling STAR', 'Respuestas estructuradas', 'Preguntas al entrevistador'],
  },
  {
    phaseNumber: 6,
    title: 'Autonomía y fluidez espontánea',
    description: 'Conversaciones extensas, múltiples acentos, simulaciones sin guion y debate técnico.',
    focusTopics: ['Escucha activa', 'Fluidez sin notas', 'Respuestas ante la incertidumbre'],
  },
];

export const SENTENCE_PATTERNS: SentencePattern[] = [
  {
    id: 'pattern-a',
    name: 'Patrón A: Sujeto + Verbo + Complemento',
    formula: 'I + [work/develop/live/study/need] + Complement',
    explanation: 'Construye oraciones directas en presente simple para comunicar tu rol, ubicación y hábitos técnicos con claridad inmediata.',
    examples: [
      'I work with Java and Angular.',
      'I develop scalable REST APIs.',
      'I live in Colombia with my family.',
      'I study technical English every day.',
    ],
    practicePrompt: 'Crea una oración personal o profesional usando el Patrón A (Sujeto + Verbo + Complemento):',
    starterVerbs: ['work', 'develop', 'live', 'study', 'need', 'specialize', 'manage'],
  },
  {
    id: 'pattern-b',
    name: 'Patrón B: Experiencia y Especialización',
    formula: 'I have experience [with / developing] + [Technology/Project]',
    explanation: 'Expresa trayectoria y áreas de dominio profesional sin titubear.',
    examples: [
      'I have experience modernizing legacy applications.',
      'I have experience developing backend services with Spring Boot.',
      'I have worked on enterprise banking projects.',
    ],
    practicePrompt: 'Describe una experiencia real de tu carrera usando este patrón:',
    starterVerbs: ['have experience with', 'have experience developing', 'have worked on'],
  },
  {
    id: 'pattern-c',
    name: 'Patrón C: Acciones en Pasado',
    formula: 'I + [Verb in Past] + [Achievement / Feature]',
    explanation: 'Narra lo que lograste o construiste en proyectos anteriores con precisión temporal.',
    examples: [
      'I modernized a legacy banking system.',
      'I implemented automated CI/CD pipelines.',
      'I coordinated technical tasks across frontend and backend.',
    ],
    practicePrompt: 'Explica una acción completada en un proyecto anterior usando verbos en pasado:',
    starterVerbs: ['modernized', 'developed', 'migrated', 'automated', 'implemented', 'designed'],
  },
  {
    id: 'pattern-d',
    name: 'Patrón D: Intención y Metas',
    formula: 'I [want to / would like to / am planning to] + Verb',
    explanation: 'Comunica tus aspiraciones y planes de carrera de manera profesional y asertiva.',
    examples: [
      'I want to improve my spoken English for global collaboration.',
      'I would like to contribute to global technology products.',
      'I am planning to relocate for the right engineering opportunity.',
    ],
    practicePrompt: 'Plantea una meta personal o profesional para tu futuro:',
    starterVerbs: ['would like to', 'want to', 'am planning to', 'aim to'],
  },
  {
    id: 'pattern-e',
    name: 'Patrón E: Preguntas Profesionales',
    formula: 'Could you + verb...? / What / Why / How...?',
    explanation: 'Formula preguntas asertivas para clarificar requerimientos o interactuar en entrevistas.',
    examples: [
      'Could you repeat the question, please?',
      'Could you tell me more about the team dynamic?',
      'What are the main engineering challenges for this role?',
    ],
    practicePrompt: 'Formula una pregunta que le harías a un entrevistador o compañero de equipo:',
    starterVerbs: ['Could you clarify', 'Could you tell me', 'How does the team', 'What technologies'],
  },
];

export const INITIAL_VOCABULARY: VocabularyWord[] = [
  { english: 'responsibility', spanish: 'responsabilidad', example: 'My main responsibility is backend and frontend architecture.', category: 'workplace' },
  { english: 'feature', spanish: 'funcionalidad / característica', example: 'I developed a new authentication feature for the client.', category: 'technical' },
  { english: 'migration', spanish: 'migración', example: 'I helped coordinate the migration from monolith to microservices.', category: 'technical' },
  { english: 'legacy system', spanish: 'sistema heredado', example: 'We modernized legacy systems using Spring Boot and Angular.', category: 'technical' },
  { english: 'deployment', spanish: 'despliegue', example: 'I automated the deployment pipeline using CI/CD and AWS.', category: 'technical' },
  { english: 'improve', spanish: 'mejorar', example: 'I want to improve my spontaneity in technical discussions.', category: 'core' },
  { english: 'explain', spanish: 'explicar', example: 'Let me explain how we resolved that concurrency issue.', category: 'core' },
  { english: 'challenge', spanish: 'desafío técnico', example: 'The main challenge was keeping backward compatibility.', category: 'core' },
  { english: 'approach', spanish: 'enfoque / abordaje', example: 'I would approach this problem by designing the API contract first.', category: 'technical' },
  { english: 'relocate', spanish: 'reubicarse / trasladarse', example: 'We are open to relocating for the right engineering opportunity.', category: 'workplace' },
];

export const INTERVIEW_QUESTIONS: InterviewQuestionItem[] = [
  {
    id: 1,
    question: 'Could you tell me about yourself?',
    category: 'introduction',
    referenceResponse: "Hi, I'm a full stack engineer with over nine years of experience specializing in Java, Spring Boot, and Angular. In my recent roles, I worked on modernizing legacy enterprise systems, building robust REST APIs and automating CI/CD pipelines. I'm interested in global engineering roles where I can solve complex technical challenges.",
  },
  {
    id: 2,
    question: 'What are your main responsibilities in your current role?',
    category: 'experience',
  },
  {
    id: 3,
    question: 'Can you describe a legacy modernization project you worked on?',
    category: 'technical',
  },
  {
    id: 4,
    question: 'How do you use Java and Angular in your daily work?',
    category: 'technical',
  },
  {
    id: 5,
    question: 'Can you explain your experience with CI/CD and AWS?',
    category: 'technical',
  },
  {
    id: 6,
    question: 'Tell me about a technical challenge you faced and how you solved it.',
    category: 'behavioral',
  },
  {
    id: 7,
    question: 'How do you handle technical disagreements with other developers?',
    category: 'behavioral',
  },
  {
    id: 8,
    question: 'Why are you interested in this role?',
    category: 'motivation',
  },
];
