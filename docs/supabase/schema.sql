-- ==============================================================================
-- English Career Playbook — Supabase Schema (Sprint 0)
-- Purpose: Persist user sessions, sentence practice attempts, and pedagogical metrics.
-- ==============================================================================

-- Enable UUID generation extension if not already enabled
create extension if not exists "uuid-ossp";

-- 1. SESSIONS TABLE
create table if not exists public.sessions (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null references auth.users(id) on delete cascade,
    session_date date not null default current_date,
    duration_minutes integer not null default 35,
    focus_theme text not null,
    notes text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS for sessions
alter table public.sessions enable row level security;

create policy "Users can select their own sessions"
    on public.sessions for select
    using (auth.uid() = user_id);

create policy "Users can insert their own sessions"
    on public.sessions for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own sessions"
    on public.sessions for update
    using (auth.uid() = user_id);

create policy "Users can delete their own sessions"
    on public.sessions for delete
    using (auth.uid() = user_id);

-- 2. PRACTICE ATTEMPTS TABLE
create table if not exists public.practice_attempts (
    id uuid primary key default uuid_generate_v4(),
    session_id uuid references public.sessions(id) on delete set null,
    user_id uuid not null references auth.users(id) on delete cascade,
    pattern_id text not null,
    user_input text not null,
    feedback_status text not null default 'valid',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS for practice_attempts
alter table public.practice_attempts enable row level security;

create policy "Users can select their own practice attempts"
    on public.practice_attempts for select
    using (auth.uid() = user_id);

create policy "Users can insert their own practice attempts"
    on public.practice_attempts for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own practice attempts"
    on public.practice_attempts for update
    using (auth.uid() = user_id);

create policy "Users can delete their own practice attempts"
    on public.practice_attempts for delete
    using (auth.uid() = user_id);

-- 3. PROGRESS EVALUATIONS TABLE (Pedagogical 1-5 Scores)
create table if not exists public.progress_evaluations (
    id uuid primary key default uuid_generate_v4(),
    session_id uuid not null references public.sessions(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    comprehension_score integer check (comprehension_score between 1 and 5),
    construction_score integer check (construction_score between 1 and 5),
    vocabulary_score integer check (vocabulary_score between 1 and 5),
    fluency_score integer check (fluency_score between 1 and 5),
    grammar_score integer check (grammar_score between 1 and 5),
    pronunciation_score integer check (pronunciation_score between 1 and 5),
    new_words_count integer default 0,
    next_goal text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS for progress_evaluations
alter table public.progress_evaluations enable row level security;

create policy "Users can select their own evaluations"
    on public.progress_evaluations for select
    using (auth.uid() = user_id);

create policy "Users can insert their own evaluations"
    on public.progress_evaluations for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own evaluations"
    on public.progress_evaluations for update
    using (auth.uid() = user_id);

create policy "Users can delete their own evaluations"
    on public.progress_evaluations for delete
    using (auth.uid() = user_id);

-- Indices for query performance
create index if not exists idx_sessions_user_date on public.sessions(user_id, session_date desc);
create index if not exists idx_practice_attempts_user on public.practice_attempts(user_id, created_at desc);
create index if not exists idx_evaluations_user on public.progress_evaluations(user_id, created_at desc);
