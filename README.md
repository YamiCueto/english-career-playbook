# English Career Playbook 🚀

[![Deploy to GitHub Pages](https://github.com/YamiCueto/english-career-playbook/actions/workflows/deploy.yml/badge.svg)](https://github.com/YamiCueto/english-career-playbook/actions/workflows/deploy.yml)
[![Live Application](https://img.shields.io/badge/Live_App-GitHub_Pages-10b981.svg)](https://yamicueto.github.io/english-career-playbook/)
[![Framework](https://img.shields.io/badge/Angular-22_Standalone-dd0031.svg)](https://angular.dev)
[![Database & Auth](https://img.shields.io/badge/Supabase-Ready_with_RLS-3ecf8e.svg)](https://supabase.com)

> Interactive web application designed for software engineers and tech professionals to develop functional, confident English for daily engineering work, international technical interviews, and global career acceleration.

🌐 **Live Application:** [https://yamicueto.github.io/english-career-playbook/](https://yamicueto.github.io/english-career-playbook/)

---

## 🎯 Purpose & Methodology

This project translates the pedagogical framework established in the [English Career Playbook](english-career-playbook.md) into an interactive, progressive web application. Rather than rote memorization or detached grammar theory, the playbook focuses on:

- **Constructing, not memorizing:** Internalizing sentence structures through active production.
- **Immediate error diagnosis:** Catching real conversational pitfalls (*"I living"*, missing professional articles, verb confusion) with actionable guidance.
- **Domain-specific relevance:** Engineering vocabulary, daily standup communication, and technical interview simulations.
- **Continuous tracking:** Local session storage with seamless Supabase synchronization.

---

## 🚀 Key Features & Pillars

### 1. 🏗️ Sentence Builder Lab (`/#/practice`)
- Interactive production studio supporting **Patterns A through E**:
  - **Pattern A:** Subject + Verb + Complement (*Simple Present for roles & daily stack*)
  - **Pattern B:** Past Experience & Trajectory (*Present Perfect & Past Simple*)
  - **Pattern C:** Intent & Future Scope (*Modal verbs & roadmap commitments*)
  - **Pattern D:** Technical Comparison & Trade-offs
  - **Pattern E:** Clarifying & Follow-up Questions for Interviewers
- **Deterministic Validation Engine:** Diagnoses common non-native construction mistakes in real time.
- **Dynamic Verb Chips & Example Loader:** Tap-to-insert professional verbs and model sentences.
- **Local Attempt History:** Persistent record of recent practice evaluations.

### 2. 📚 Block Bank & Active Vocabulary (`/#/playbook`)
- Filterable technical glossary categorized into *Engineering Terms*, *Daily Work / Meetings*, and *Core Vocabulary*.
- Technical interview question bank covering background, architecture decisions, and behavioral scenarios.

### 3. 📊 Progress Dashboard (`/#/dashboard`)
- Real-time tracker for sentence production metrics, active patterns, and vocabulary mastery.
- Interactive roadmap highlighting the **6 Progressive Learning Phases**:
  1. Personal Base & Daily Engineering Construction
  2. Professional History & Project Experience
  3. Daily Standup, Code Reviews & Team Collaboration
  4. Technical Explanations & Architecture Trade-offs
  5. Global Interview Strategy & STAR Framework
  6. Conversational Autonomy & Debate

### 4. ⚡ Resilient Synchronization
- Transparent local-first persistence (`localStorage`).
- Ready-to-connect Supabase client for remote user progress with zero vendor lock-in.

---

## 🛠️ Architecture & Technical Foundation

- **Frontend Framework:** [Angular 22](https://angular.dev) (Standalone components, signal-friendly design).
- **Routing:** Hash-based routing (`withHashLocation()`) ensuring seamless navigation and 404 resiliency on static hosts.
- **Styling:** Vanilla CSS with custom design tokens, dark theme, fluid typography (`clamp`), and glassmorphism.
- **Responsive Design:** Strict **mobile-first** architecture verified via automated headless Chrome CDP testing across 5 viewports:
  - Mobile (360×800, 390×844, 412×915) with compact sticky header, bottom navigation bar, and horizontal scroll affordances.
  - Tablet (768×1024) with multi-column composition and clean tablet header.
  - Desktop (1440×900) with top navigation links and expanded layouts.
- **Database & Security:** PostgreSQL DDL with Row Level Security ([`docs/supabase/schema.sql`](docs/supabase/schema.sql)) ensuring user isolation (`auth.uid() = user_id`).
- **CI/CD:** Automated pipeline via GitHub Actions ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) running unit tests, generating production bundles, and deploying to GitHub Pages.

---

## 📂 Project Structure

```text
english-career-playbook/
├── .github/workflows/
│   └── deploy.yml                     # Automated build, test, and Pages deployment
├── docs/
│   ├── architecture/
│   │   └── sprint-0-contract.md       # Foundation architecture & security contract
│   └── supabase/
│       └── schema.sql                 # PostgreSQL DDL and RLS security policies
├── reports/
│   ├── responsive-audit.json          # Automated viewport audit metrics
│   └── screenshots/                   # Verification captures across 5 viewports
├── scripts/
│   ├── copy-404.mjs                   # Cross-platform SPA 404 fallback generator
│   └── verify-responsive.mjs          # Headless Chrome CDP viewport audit script
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── content/               # Decoupled pedagogical content
│   │   │   ├── models/                # Strongly-typed TypeScript interfaces
│   │   │   └── services/              # Supabase and LocalStorage storage services
│   │   ├── features/
│   │   │   ├── dashboard/             # Dashboard component & learning phases
│   │   │   ├── playbook/              # Vocabulary & interview reference
│   │   │   └── practice/              # Sentence construction laboratory
│   │   ├── app.component.*            # Responsive app shell & navigation
│   │   ├── app.config.ts              # Standalone app configuration
│   │   └── app.routes.ts              # Client-side hash routing
│   ├── environments/                  # Environment configuration
│   └── styles.css                     # Global design tokens & CSS resets
├── english-career-playbook.md         # Source pedagogical documentation
├── package.json
└── README.md
```

---

## 💻 Getting Started

### Prerequisites
- **Node.js:** v20 or higher (v22 recommended)
- **npm:** v10 or higher

### Installation
```bash
git clone https://github.com/YamiCueto/english-career-playbook.git
cd english-career-playbook
npm install
```

### Development Server
```bash
npm start
```
Navigate to `http://localhost:4200/`. The application will automatically reload when source files change.

### Running Unit Tests
```bash
npm test -- --watch=false
```
Executes all unit tests using the built-in runner.

### Production Build
```bash
npm run build:gh-pages
```
Compiles the application with `--base-href /english-career-playbook/` and copies the `404.html` SPA fallback to `dist/english-career-playbook/browser`.

### Responsive Viewport Audit
```bash
npm run audit:responsive
```
Executes automated headless Chrome viewport checks, confirming `scrollWidth <= clientWidth` across mobile, tablet, and desktop viewports, and captures inspection screenshots to `reports/screenshots/`.

---

## 🔒 Security & Privacy

- Public repository code is strictly decoupled from personal identifiable information.
- Supabase credentials use public anon keys restricted by Row Level Security (RLS) policies.
- Anonymous and local users can practice freely without exposing session data.

---

## 📄 License & Credits

Developed by **Yamid Cueto** as an open-source technical career companion.
Based on the methodologies from the [English Career Playbook](english-career-playbook.md).
