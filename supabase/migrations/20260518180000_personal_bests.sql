-- Manual race / time-trial entries for personal-best tracking.
--
-- Derived bests are already computed from the activities table by
-- lib/run/best_efforts.ts. This table covers cases where derivation
-- can't pick up the real PB:
--   * activity is shorter than the target distance (e.g. a marathon
--     where the watch died at 34 km — the actual race time still
--     beats any 42 km derivation)
--   * user raced on a different platform, or has historical PBs
--     predating Strava sync
--   * user wants to record the *split* time inside a longer activity
--     (Strava best_efforts) without changing the activity itself.
--
-- The bestEfforts() merger prefers whichever of derived | logged | synced
-- has the lowest time_s for a given distance bucket.

create table if not exists public.personal_bests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  distance_m numeric not null check (distance_m > 0),
  time_s integer not null check (time_s > 0),
  achieved_at date not null,
  event_name text,
  activity_id bigint references public.activities(id) on delete set null,
  source text not null default 'logged'
    check (source in ('logged', 'derived', 'synced')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists personal_bests_user_distance_idx
  on public.personal_bests (user_id, distance_m, time_s);

alter table public.personal_bests enable row level security;

drop policy if exists "personal_bests_own" on public.personal_bests;
create policy "personal_bests_own" on public.personal_bests
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
