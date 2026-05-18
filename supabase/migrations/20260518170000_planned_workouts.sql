-- Planned workouts on training_sessions.
--
-- Adds:
--   1. status enum (planned | completed | skipped)
--   2. description jsonb for plan metadata (target HR, pace, distance, reason)
--   3. matched_activity_id FK linking a completed planned run to its Strava row
--   4. extended modality enum: run_easy / tempo / long / ... + rest
--   5. partial index on (user_id, session_at) for upcoming-planned lookups
--
-- Existing rows default to status='completed' so they keep showing up on
-- the dashboard as past sessions. New planned rows are inserted with
-- status='planned' explicitly via the API.

alter table public.training_sessions
  add column if not exists status text not null default 'completed'
    check (status in ('planned', 'completed', 'skipped'));

alter table public.training_sessions
  add column if not exists description jsonb;

alter table public.training_sessions
  add column if not exists matched_activity_id bigint
    references public.activities(id) on delete set null;

-- Extend the modality check to cover planned runs (run_easy, run_tempo, ...)
-- and explicit rest days. We drop the prior constraint and re-add with the
-- full list so the order is stable in pg_dump.
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
    'run_easy',
    'run_tempo',
    'run_long',
    'run_threshold',
    'run_vo2',
    'run_race',
    'run_recovery',
    'rest',
    'other'
  ));

-- Partial index on planned rows. The dashboard's "this week + next 3 weeks"
-- view filters on status='planned' + session_at >= now, so this is the
-- hot read path.
create index if not exists training_sessions_planned_idx
  on public.training_sessions (user_id, session_at)
  where status = 'planned';
