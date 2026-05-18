-- Audit-driven schema gap fixes. Additive only.
--
-- 1. New `shoes` table (gear tracking).
-- 2. New columns on `activities` for richer run logging
--    (rpe, weather, shoe_id, surface, run_type) + source provenance.
-- 3. New columns on `daily_log` for the expanded morning/wellness log.
-- 4. Extend `training_sessions.modality` enum (add strength_full, cycling,
--    swimming) + source provenance.
--
-- RLS discipline (per project convention with "automatic RLS" OFF): every
-- new table enables RLS explicitly and ships an "own rows" policy.
-- Service role bypasses RLS.

-- 1. shoes ------------------------------------------------------------------

create table if not exists public.shoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand text,
  model text,
  purchase_date date,
  retire_at_km numeric not null default 700 check (retire_at_km > 0),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shoes_user_idx
  on public.shoes (user_id, created_at desc);

alter table public.shoes enable row level security;

drop policy if exists "shoes_own" on public.shoes;
create policy "shoes_own" on public.shoes
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. activities additive columns -------------------------------------------
--
-- New rows from Strava sync default source='synced'. Existing rows get
-- 'synced' from the column default. Manual entries should set 'logged'.

alter table public.activities
  add column if not exists rpe_1_10 smallint
    check (rpe_1_10 is null or rpe_1_10 between 1 and 10);

alter table public.activities
  add column if not exists weather jsonb;

alter table public.activities
  add column if not exists shoe_id uuid references public.shoes(id) on delete set null;

alter table public.activities
  add column if not exists surface text
    check (surface is null or surface in ('road','trail','track','treadmill'));

alter table public.activities
  add column if not exists run_type text
    check (run_type is null or run_type in
      ('easy','long','tempo','threshold','vo2','race','recovery'));

alter table public.activities
  add column if not exists source text not null default 'synced'
    check (source in ('logged','synced','inferred'));

create index if not exists activities_shoe_idx
  on public.activities (shoe_id)
  where shoe_id is not null;

-- 3. daily_log additive columns --------------------------------------------
--
-- Existing columns (sleep_score 0-100, energy 1-5, habit_* booleans) are
-- preserved. New nullable fields cover the expanded morning/wellness log.

alter table public.daily_log
  add column if not exists sleep_quality_1_5 smallint
    check (sleep_quality_1_5 is null or sleep_quality_1_5 between 1 and 5);

alter table public.daily_log
  add column if not exists bedtime time;

alter table public.daily_log
  add column if not exists wake_time time;

alter table public.daily_log
  add column if not exists morning_rhr_bpm smallint
    check (morning_rhr_bpm is null or morning_rhr_bpm between 20 and 200);

alter table public.daily_log
  add column if not exists hrv_ms smallint
    check (hrv_ms is null or hrv_ms between 1 and 500);

alter table public.daily_log
  add column if not exists soreness jsonb;

alter table public.daily_log
  add column if not exists water_l numeric
    check (water_l is null or (water_l >= 0 and water_l <= 20));

alter table public.daily_log
  add column if not exists caffeine_mg smallint
    check (caffeine_mg is null or (caffeine_mg >= 0 and caffeine_mg <= 2000));

alter table public.daily_log
  add column if not exists caffeine_last_at timestamptz;

alter table public.daily_log
  add column if not exists alcohol_units numeric
    check (alcohol_units is null or (alcohol_units >= 0 and alcohol_units <= 50));

alter table public.daily_log
  add column if not exists body_weight_kg numeric
    check (body_weight_kg is null or (body_weight_kg > 20 and body_weight_kg < 250));

alter table public.daily_log
  add column if not exists mood_1_5 smallint
    check (mood_1_5 is null or mood_1_5 between 1 and 5);

alter table public.daily_log
  add column if not exists stress_1_5 smallint
    check (stress_1_5 is null or stress_1_5 between 1 and 5);

alter table public.daily_log
  add column if not exists source text not null default 'logged'
    check (source in ('logged','synced','inferred'));

-- 4. training_sessions: extend modality enum + add source ------------------
--
-- The original check constraint was created inline so Postgres named it
-- training_sessions_modality_check. Drop it (if present under that name)
-- and recreate with the extended value list.

alter table public.training_sessions
  drop constraint if exists training_sessions_modality_check;

alter table public.training_sessions
  add constraint training_sessions_modality_check
  check (modality in (
    'strength_upper',
    'strength_lower',
    'strength_full',
    'football',
    'cycling',
    'swimming',
    'mobility',
    'other'
  ));

alter table public.training_sessions
  add column if not exists source text not null default 'logged'
    check (source in ('logged','synced','inferred'));
