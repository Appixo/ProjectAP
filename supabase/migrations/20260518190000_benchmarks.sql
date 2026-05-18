-- Benchmark / test workout results. Stores the *outputs* of formal
-- fitness tests (max HR test, LTHR test, VO2 estimate, time trials) so
-- the AI coach and the dashboard's derived metrics can anchor zones on
-- measured values rather than percentile estimates.
--
-- The actual run of the test still lives in `activities` (linked via
-- activity_id). This table records what the test *measured*.

create table if not exists public.benchmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  performed_at date not null,
  test_type text not null check (test_type in (
    'max_hr_test',
    'lthr_test',
    'vo2_test',
    'race_5k',
    'race_10k',
    'race_half',
    'race_full',
    'other'
  )),
  max_hr_bpm smallint
    check (max_hr_bpm is null or max_hr_bpm between 100 and 220),
  lthr_bpm smallint
    check (lthr_bpm is null or lthr_bpm between 100 and 220),
  vo2max_ml_per_kg_min numeric
    check (vo2max_ml_per_kg_min is null
      or (vo2max_ml_per_kg_min >= 20 and vo2max_ml_per_kg_min <= 90)),
  pace_at_threshold_s_per_km integer
    check (pace_at_threshold_s_per_km is null
      or pace_at_threshold_s_per_km between 120 and 900),
  activity_id bigint references public.activities(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists benchmarks_user_perf_idx
  on public.benchmarks (user_id, performed_at desc);

alter table public.benchmarks enable row level security;

drop policy if exists "benchmarks_own" on public.benchmarks;
create policy "benchmarks_own" on public.benchmarks
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
