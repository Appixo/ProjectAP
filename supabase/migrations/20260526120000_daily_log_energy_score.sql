-- Add Samsung's daily Energy Score (0–100) to daily_log.
--
-- This is a separate, objective field that lives alongside the existing
-- subjective `energy` 1–5 self-rating. The Samsung Energy Score is hand-
-- entered each morning from the watch / Samsung Health screen — it does
-- NOT come through Health Connect.
--
-- Band labels ("Good"/"Excellent") are intentionally not stored — derive
-- from the number if ever displayed.
--
-- Additive, nullable, idempotent. No existing columns touched.

alter table public.daily_log
  add column if not exists energy_score smallint
    check (energy_score is null or energy_score between 0 and 100);

-- ---------------------------------------------------------------------------
-- ROLLBACK (do not apply via `supabase db push` — this block is intentionally
-- a comment so the forward migration is the only thing the CLI sees). To
-- revert, run the statement below manually in Supabase Studio:
--
--   alter table public.daily_log drop column if exists energy_score;
-- ---------------------------------------------------------------------------
