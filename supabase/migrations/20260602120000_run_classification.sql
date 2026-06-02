-- Run-classification fix: stop quality runs (intervals / threshold) being
-- tagged "easy" off a recovery-dragged average HR or pace. Additive only.
--
-- 1. activities.hr_above_tempo_pct — fraction (0-100) of moving time spent at
--    or above the tempo HR floor, computed from the Strava HR stream at
--    ingest. The HR-distribution rule: >15% above the floor ⇒ not easy.
-- 2. activities.laps — compact per-lap splits parsed from the Strava activity
--    detail (laps / splits_standard). Powers the weekly runs table splits view
--    and the interval-structure signal.
-- 3. activities.interval_structure — precomputed boolean: lap variance looks
--    like an interval/threshold session (distinct fast work segments separated
--    by slower recoveries). Used by the classifier so SSR / export don't have
--    to re-parse laps.
-- 4. Backfill activities.run_type from already-matched planned run_* sessions,
--    so the dashboard and /api/export read one source of truth for type.
--
-- No new tables, so no RLS policy changes — activities already has RLS + an
-- "own rows" policy from the init migration; the service role (used by the
-- webhook + export) bypasses RLS regardless.

alter table public.activities
  add column if not exists hr_above_tempo_pct numeric
    check (hr_above_tempo_pct is null
      or (hr_above_tempo_pct >= 0 and hr_above_tempo_pct <= 100));

alter table public.activities
  add column if not exists laps jsonb;

alter table public.activities
  add column if not exists interval_structure boolean;

-- Backfill run_type from completed/planned run_* sessions that already point
-- at an activity. Only fills rows where run_type is still null so a manual
-- override (or a future re-derivation) is never clobbered. The CASE mirrors
-- modalityToRunType() in lib/run/classify.ts — keep the two in sync.
update public.activities a
set run_type = case ts.modality
    when 'run_easy' then 'easy'
    when 'run_recovery' then 'recovery'
    when 'run_tempo' then 'tempo'
    when 'run_threshold' then 'threshold'
    when 'run_vo2' then 'vo2'
    when 'run_long' then 'long'
    when 'run_race' then 'race'
  end
from public.training_sessions ts
where ts.matched_activity_id = a.id
  and ts.modality like 'run_%'
  and ts.modality in (
    'run_easy', 'run_recovery', 'run_tempo', 'run_threshold',
    'run_vo2', 'run_long', 'run_race'
  )
  and a.run_type is null;
