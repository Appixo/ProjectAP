-- Initial schema for the Consistent training dashboard.
--
-- Apply: paste this file into Supabase Studio -> SQL Editor -> Run.
-- Project: HealthDataAP (EU).
--
-- The Supabase project has "Enable automatic RLS" OFF, so every table here
-- enables RLS explicitly and ships at least one policy. Tables that have
-- no policy (strava_webhook_events) are deliberately locked: RLS-enabled +
-- no policy means anon/authenticated clients can read nothing, while the
-- service-role key used by webhook + export handlers bypasses RLS.

create table if not exists public.strava_account (
  user_id uuid primary key references auth.users(id) on delete cascade,
  athlete_id bigint not null unique,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  scope text,
  updated_at timestamptz not null default now()
);

create table if not exists public.activities (
  id bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id bigint not null,
  start_at timestamptz not null,
  start_at_local timestamp not null,
  timezone text,
  name text,
  type text not null,
  distance_m numeric not null,
  moving_time_s integer not null,
  elapsed_time_s integer not null,
  total_elevation_gain_m numeric,
  average_heartrate numeric,
  max_heartrate numeric,
  average_speed_mps numeric,
  max_speed_mps numeric,
  has_heartrate boolean not null default false,
  raw jsonb,
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists activities_user_start_idx
  on public.activities (user_id, start_at desc);

create table if not exists public.daily_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  sleep_hours numeric,
  sleep_score smallint check (sleep_score between 0 and 100),
  energy smallint check (energy between 1 and 5),
  habit_strength_done boolean not null default false,
  habit_no_alcohol boolean not null default false,
  habit_in_bed_on_time boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, log_date)
);

create table if not exists public.export_tokens (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked boolean not null default false
);

create table if not exists public.strava_webhook_events (
  id bigserial primary key,
  received_at timestamptz not null default now(),
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text
);

-- Enable RLS on every table.
alter table public.strava_account enable row level security;
alter table public.activities enable row level security;
alter table public.daily_log enable row level security;
alter table public.export_tokens enable row level security;
alter table public.strava_webhook_events enable row level security;

-- "Own rows" policies for the user-scoped tables. Service-role bypasses RLS.
drop policy if exists "strava_account_own" on public.strava_account;
create policy "strava_account_own" on public.strava_account
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "activities_own" on public.activities;
create policy "activities_own" on public.activities
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "daily_log_own" on public.daily_log;
create policy "daily_log_own" on public.daily_log
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "export_tokens_own" on public.export_tokens;
create policy "export_tokens_own" on public.export_tokens
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- strava_webhook_events: no policy on purpose. Only the service role
-- (used by the webhook handler) writes here; the dashboard UI never
-- reads from this table directly.
