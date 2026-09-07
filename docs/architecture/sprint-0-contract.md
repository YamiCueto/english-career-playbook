# Contrato de Arquitectura y Producto — Sprint 0: Fundación Técnica

## 1. Propósito y Límites del Sprint 0

El objetivo del Sprint 0 es establecer los cimientos técnicos de **English Career Playbook** como una Single Page Application (SPA) en Angular standalone lista para su despliegue estático en **GitHub Pages**, desacoplando el contenido pedagógico público de la capa de persistencia privada en **Supabase**.

### En Alcance
- **Scaffold Angular 22:** Standalone components, routing con `withHashLocation()`, tipado estricto en TypeScript.
- **Contenido Desacoplado:** Modelos de datos y contenido pedagógico base (patrones gramaticales, banco de vocabulario y preguntas de entrevistas) versionados en Git dentro de `src/app/core/content/`.
- **Shell y Layout Responsive:** Interfaz móvil (bottom navigation) y escritorio (sidebar/header) con diseño moderno, accesible y sin dependencias de frameworks CSS pesados.
- **Módulo de Muestra (Laboratorio 01 — Patrón A):** Ejercicio interactivo y determinista para construcción de oraciones (`sujeto + verbo + complemento`), sin dependencias de IA externa ni audio sintético.
- **Contrato Supabase:** Esquema SQL DDL con Row Level Security (RLS) para tablas `sessions`, `practice_attempts` y `progress_evaluations`. Servicio cliente con fallback para modo sin conexión / invitado.
- **CI/CD Automatizado:** Pipeline en GitHub Actions para validación y despliegue a GitHub Pages con `base-href /english-career-playbook/`.

### Fuera de Alcance (Sprints Posteriores)
- Servicios de transcripción o reconocimiento de voz por IA (Web Speech API o Whisper).
- Evaluación automática de fluidez con modelos de lenguaje externos.
- Spring Boot o servidores backend personalizados (se mantiene arquitectura cliente-servidor directa a Supabase).

---

## 2. Diagrama de Arquitectura de Datos

```
[ Git Repository ]
   └── src/app/core/content/
         ├── patterns.content.ts     (Público: Laboratorio de patrones A-E)
         ├── vocabulary.content.ts   (Público: Banco de términos técnicos)
         └── interview.content.ts    (Público: Preguntas STAR, Amadeus & Tech)

[ Supabase (PostgreSQL + Auth + RLS) ]
   ├── auth.users                    (Identidad privada del usuario)
   ├── public.sessions               (Registros de sesiones de 35 min)
   ├── public.practice_attempts      (Intentos de oraciones en el laboratorio)
   └── public.progress_evaluations   (Métricas pedagógicas 1-5 por sesión)
```

---

## 3. Modelo de Entidades

### Sesión de Aprendizaje (`Session`)
Representa una sesión de práctica diaria estructurada (según el método de 35 minutos del playbook).
- `id`: UUID (PK)
- `user_id`: UUID (FK `auth.users`)
- `session_date`: Date
- `duration_minutes`: Integer (default 35)
- `focus_theme`: String (e.g. "Laboratorio 01 — Patrón A")
- `notes`: Text (opcional)
- `created_at`: Timestamp

### Intento de Práctica (`PracticeAttempt`)
Registra cada oración construida por el usuario dentro del laboratorio.
- `id`: UUID (PK)
- `session_id`: UUID (FK `sessions`, opcional)
- `user_id`: UUID (FK `auth.users`)
- `pattern_id`: String (e.g. "pattern-a")
- `user_input`: Text (oración escrita por el usuario)
- `feedback_status`: Enum ('valid', 'needs_review', 'custom')
- `created_at`: Timestamp

### Evaluación Pedagógica (`ProgressEvaluation`)
Puntuación de 1 a 5 según la sección 10 del Playbook.
- `id`: UUID (PK)
- `session_id`: UUID (FK `sessions`)
- `user_id`: UUID (FK `auth.users`)
- `comprehension_score`: Integer (1-5)
- `construction_score`: Integer (1-5)
- `vocabulary_score`: Integer (1-5)
- `fluency_score`: Integer (1-5)
- `grammar_score`: Integer (1-5)
- `pronunciation_score`: Integer (1-5)
- `new_words_count`: Integer
- `next_goal`: Text
- `created_at`: Timestamp

---

## 4. Estrategia de Seguridad y Variables de Entorno

1. **Frontend Seguro:**
   - La aplicación Angular solo almacenará y expondrá la `SUPABASE_URL` y la `SUPABASE_ANON_KEY`.
   - Estas credenciales son seguras para distribución pública en una SPA porque la seguridad real la aplica PostgreSQL mediante **Row Level Security (RLS)**.
2. **Políticas RLS:**
   - Cada usuario únicamente puede leer, crear y modificar sus propios registros (`auth.uid() = user_id`).
   - Queda terminantemente prohibido incorporar `service_role_key` o credenciales administrativas de Supabase en el repositorio o en los bundles de frontend.
3. **Modo Offline / Resiliencia:**
   - Si no se configuran variables de entorno de Supabase o no hay conexión, la aplicación funciona en modo de prueba local/invitado usando almacenamiento en memoria o `localStorage`, garantizando una experiencia fluida sin bloqueos.
