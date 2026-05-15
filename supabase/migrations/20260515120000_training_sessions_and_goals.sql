-- Training sessions (non-Strava modalities: strength, football, mobility)
-- + per-user goals row that the AI export reads.
--
-- Apply: paste this file into Supabase Studio -> SQL Editor -> Run.
--
-- Same RLS discipline as 0001: every table enables RLS explicitly and
-- ships an "own rows" policy for authenticated clients. Service-role
-- bypasses RLS.

create table if not exists public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_at timestamptz not null,
  session_at_local timestamp not null,
  timezone text not null default 'Europe/Amsterdam',
  modality text not null check (modality in (
    'strength_upper',
    'strength_lower',
    'football',
    'mobility',
    'other'
  )),
  duration_min smallint check (duration_min > 0 and duration_min <= 600),
  rpe smallint check (rpe between 1 and 10),
  format text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists training_sessions_user_at_idx
  on public.training_sessions (user_id, session_at desc);

create table if not exists public.goals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  primary_goal text not null,
  primary_event_date date,
  secondary_goal text,
  secondary_event_date date,
  secondary_kind text,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.training_sessions enable row level security;
alter table public.goals enable row level security;

drop policy if exists "training_sessions_own" on public.training_sessions;
create policy "training_sessions_own" on public.training_sessions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "goals_own" on public.goals;
create policy "goals_own" on public.goals
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
