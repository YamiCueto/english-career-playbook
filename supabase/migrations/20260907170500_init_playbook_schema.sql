create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon;
grant execute on function public.set_updated_at() to authenticated;

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text check (display_name is null or (length(trim(display_name)) > 0 and length(display_name) <= 100)),
    avatar_url text check (avatar_url is null or (length(avatar_url) <= 1000 and avatar_url ~* '^https?://')),
    preferred_language text not null default 'es' check (preferred_language in ('es', 'en')),
    timezone text not null default 'UTC' check (length(trim(timezone)) > 0 and length(timezone) <= 64),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
    on public.profiles for select
    using ((select auth.uid()) = id);

create policy "profiles_insert_own"
    on public.profiles for insert
    with check ((select auth.uid()) = id);

create policy "profiles_update_own"
    on public.profiles for update
    using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

create trigger trg_profiles_updated_at
    before update on public.profiles
    for each row
    execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_display_name text;
    v_avatar_url text;
    v_timezone text;
begin
    v_display_name := nullif(trim(coalesce(
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name',
        new.raw_user_meta_data ->> 'user_name',
        split_part(new.email, '@', 1),
        'Learner'
    )), '');

    if v_display_name is not null then
        v_display_name := substr(v_display_name, 1, 100);
    else
        v_display_name := 'Learner';
    end if;

    v_avatar_url := nullif(trim(coalesce(
        new.raw_user_meta_data ->> 'avatar_url',
        new.raw_user_meta_data ->> 'picture'
    )), '');

    if v_avatar_url is not null then
        v_avatar_url := substr(v_avatar_url, 1, 1000);
        if not (v_avatar_url ~* '^https?://') then
            v_avatar_url := null;
        end if;
    end if;

    v_timezone := nullif(trim(coalesce(
        new.raw_user_meta_data ->> 'timezone',
        'UTC'
    )), '');

    if v_timezone is not null then
        v_timezone := substr(v_timezone, 1, 64);
    else
        v_timezone := 'UTC';
    end if;

    insert into public.profiles (
        id,
        display_name,
        avatar_url,
        preferred_language,
        timezone
    )
    values (
        new.id,
        v_display_name,
        v_avatar_url,
        'es',
        v_timezone
    )
    on conflict (id) do update set
        display_name = coalesce(public.profiles.display_name, excluded.display_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        updated_at = now();

    return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user();

create table public.sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    session_date date not null default current_date,
    duration_minutes integer not null default 35 check (duration_minutes > 0 and duration_minutes <= 480),
    focus_theme text not null check (length(trim(focus_theme)) > 0),
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_sessions_id_user unique (id, user_id)
);

alter table public.sessions enable row level security;

create policy "sessions_select_own"
    on public.sessions for select
    using ((select auth.uid()) = user_id);

create policy "sessions_insert_own"
    on public.sessions for insert
    with check ((select auth.uid()) = user_id);

create policy "sessions_update_own"
    on public.sessions for update
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

create policy "sessions_delete_own"
    on public.sessions for delete
    using ((select auth.uid()) = user_id);

create trigger trg_sessions_updated_at
    before update on public.sessions
    for each row
    execute function public.set_updated_at();

create table public.practice_attempts (
    id uuid primary key default gen_random_uuid(),
    session_id uuid,
    user_id uuid not null references auth.users(id) on delete cascade,
    pattern_id text not null check (length(trim(pattern_id)) > 0),
    user_input text not null check (length(trim(user_input)) > 0),
    feedback_status text not null default 'valid' check (feedback_status in ('valid', 'needs_practice', 'review_required', 'mastered')),
    created_at timestamptz not null default now(),
    constraint fk_practice_attempts_session foreign key (session_id, user_id) references public.sessions(id, user_id) on delete cascade
);

alter table public.practice_attempts enable row level security;

create policy "practice_attempts_select_own"
    on public.practice_attempts for select
    using ((select auth.uid()) = user_id);

create policy "practice_attempts_insert_own"
    on public.practice_attempts for insert
    with check (
        (select auth.uid()) = user_id
        and (
            session_id is null
            or exists (
                select 1 from public.sessions s
                where s.id = session_id and s.user_id = (select auth.uid())
            )
        )
    );

create policy "practice_attempts_update_own"
    on public.practice_attempts for update
    using ((select auth.uid()) = user_id)
    with check (
        (select auth.uid()) = user_id
        and (
            session_id is null
            or exists (
                select 1 from public.sessions s
                where s.id = session_id and s.user_id = (select auth.uid())
            )
        )
    );

create policy "practice_attempts_delete_own"
    on public.practice_attempts for delete
    using ((select auth.uid()) = user_id);

create table public.progress_evaluations (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    comprehension_score integer check (comprehension_score between 1 and 5),
    construction_score integer check (construction_score between 1 and 5),
    vocabulary_score integer check (vocabulary_score between 1 and 5),
    fluency_score integer check (fluency_score between 1 and 5),
    grammar_score integer check (grammar_score between 1 and 5),
    pronunciation_score integer check (pronunciation_score between 1 and 5),
    new_words_count integer not null default 0 check (new_words_count >= 0),
    next_goal text,
    created_at timestamptz not null default now(),
    constraint fk_evaluations_session foreign key (session_id, user_id) references public.sessions(id, user_id) on delete cascade,
    constraint uq_evaluations_session unique (session_id)
);

alter table public.progress_evaluations enable row level security;

create policy "evaluations_select_own"
    on public.progress_evaluations for select
    using ((select auth.uid()) = user_id);

create policy "evaluations_insert_own"
    on public.progress_evaluations for insert
    with check (
        (select auth.uid()) = user_id
        and exists (
            select 1 from public.sessions s
            where s.id = session_id and s.user_id = (select auth.uid())
        )
    );

create policy "evaluations_update_own"
    on public.progress_evaluations for update
    using ((select auth.uid()) = user_id)
    with check (
        (select auth.uid()) = user_id
        and exists (
            select 1 from public.sessions s
            where s.id = session_id and s.user_id = (select auth.uid())
        )
    );

create policy "evaluations_delete_own"
    on public.progress_evaluations for delete
    using ((select auth.uid()) = user_id);

create index idx_sessions_user_date on public.sessions(user_id, session_date desc);
create index idx_sessions_user_created on public.sessions(user_id, created_at desc);
create index idx_practice_attempts_user_pattern on public.practice_attempts(user_id, pattern_id, created_at desc);
create index idx_practice_attempts_session_user on public.practice_attempts(session_id, user_id);
create index idx_practice_attempts_user_created on public.practice_attempts(user_id, created_at desc);
create index idx_evaluations_user_created on public.progress_evaluations(user_id, created_at desc);

grant usage on schema public to authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.practice_attempts to authenticated;
grant select, insert, update, delete on public.progress_evaluations to authenticated;

revoke all on public.profiles from anon;
revoke all on public.sessions from anon;
revoke all on public.practice_attempts from anon;
revoke all on public.progress_evaluations from anon;
