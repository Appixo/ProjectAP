# Personal marathon-prep training dashboard — implementation plan

## Context

Preparing for a marathon on **2026-11-01** (~5.5 months from project kickoff
on 2026-05-14). This is a single-user web app that consolidates three streams
of information that today live in different places:

1. **Strava activities** (run-only) — auto-synced.
2. **Daily subjective state** (sleep hours, Samsung Health sleep score 0-100,
   energy 1-5, 3 habit checkboxes, free-text notes) — manually logged each
   morning.
3. **A read-only JSON export** so the user can paste a tokenized URL into
   Claude.ai for periodic analysis without exposing the dashboard publicly.

The dashboard graphs weekly mileage, pace trends, HR-zone time (post-MVP),
and sleep vs. energy correlation. Built to be private (allowlisted
magic-link auth), boring (proven stack), and finishable in ~3 weeks of
evenings on free tiers.

## Decisions

| Question | Choice |
|---|---|
| Activity scope | **Runs only** — filter at webhook ingest |
| Units | **km, min/km** |
| Stream depth | **Summary stats per activity** (no per-second streams) |
| Sleep score | **Manual number field** (0-100) on daily log |
| Dev tunnel | **Cloudflare Tunnel** (named, stable) |
| Habit checkboxes (default — easy to swap) | Strength/mobility done; No alcohol; In bed by target time |

Stack: Next.js 15 App Router + TypeScript + Supabase (Postgres + Auth) +
Recharts + Tailwind + Vercel free + pnpm.

## Project structure

```
consistent/
├── app/
│   ├── (dashboard)/
│   │   ├── layout.tsx              # auth-gated shell + nav
│   │   ├── page.tsx                # main dashboard (charts + activity table)
│   │   ├── log/page.tsx            # daily log form
│   │   └── settings/page.tsx       # connect Strava, manage export tokens
│   ├── api/
│   │   ├── strava/
│   │   │   ├── webhook/route.ts    # GET verify + POST events
│   │   │   └── oauth/route.ts      # OAuth callback handler
│   │   └── export/route.ts         # token-gated JSON
│   ├── login/page.tsx              # magic-link request
│   ├── auth/callback/route.ts      # Supabase auth callback
│   └── layout.tsx                  # root layout (fonts, providers)
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # browser client (cookies)
│   │   ├── server.ts               # server-side w/ user session
│   │   └── admin.ts                # service-role (server-only)
│   ├── strava/
│   │   ├── client.ts               # fetch wrapper w/ token refresh
│   │   ├── transform.ts            # Strava payload → activities row
│   │   └── webhook.ts              # verify_token check, event router
│   ├── auth/
│   │   └── allowlist.ts            # single-email gate
│   └── time/
│       └── week.ts                 # Mon-Sun bucketing in Europe/Amsterdam
├── components/
│   ├── charts/
│   │   ├── WeeklyMileage.tsx
│   │   ├── PaceTrend.tsx
│   │   ├── HrZones.tsx             # post-MVP toggle
│   │   └── SleepEnergy.tsx
│   ├── DailyLogForm.tsx
│   ├── ActivityTable.tsx
│   └── StravaConnectButton.tsx
├── supabase/
│   └── migrations/                 # numbered SQL files, applied via CLI
├── scripts/
│   ├── strava-subscribe.ts         # one-time push subscription registration
│   └── strava-backfill.ts          # local-only; pulls historical activities
├── middleware.ts                   # auth gate for /(dashboard) routes
├── .env.local.example
├── .gitignore                      # includes .claude/, CLAUDE.md
└── package.json
```

## Supabase schema

Multi-user even though single-user, so RLS works naturally without later
refactor. **The Supabase project has "Enable automatic RLS" OFF**, so every
migration must `enable row level security` + add policies explicitly.

```sql
-- 0001_init.sql

create table strava_account (
  user_id uuid primary key references auth.users(id) on delete cascade,
  athlete_id bigint not null unique,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  scope text,
  updated_at timestamptz default now()
);

create table activities (
  id bigint primary key,                  -- Strava activity id
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id bigint not null,
  start_at timestamptz not null,
  start_at_local timestamp not null,
  timezone text,
  name text,
  type text not null,                     -- always 'Run' for MVP, but kept
  distance_m numeric not null,
  moving_time_s integer not null,
  elapsed_time_s integer not null,
  total_elevation_gain_m numeric,
  average_heartrate numeric,
  max_heartrate numeric,
  average_speed_mps numeric,              -- pace_min_per_km = 1000/avg_speed/60
  max_speed_mps numeric,
  has_heartrate boolean default false,
  raw jsonb,                              -- full Strava payload
  ingested_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index activities_user_start_idx on activities (user_id, start_at desc);

create table daily_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  sleep_hours numeric,
  sleep_score smallint check (sleep_score between 0 and 100),
  energy smallint check (energy between 1 and 5),
  habit_strength_done boolean default false,
  habit_no_alcohol boolean default false,
  habit_in_bed_on_time boolean default false,
  notes text,
  updated_at timestamptz default now(),
  primary key (user_id, log_date)
);

create table export_tokens (
  token_hash text primary key,            -- sha256 of token; raw shown once
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  created_at timestamptz default now(),
  last_used_at timestamptz,
  revoked boolean default false
);

create table strava_webhook_events (
  id bigserial primary key,
  received_at timestamptz default now(),
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text
);

-- For every table:
--   alter table <name> enable row level security;
--   create policy "own_rows" on <name> for all
--     using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Service-role client (webhook + export) bypasses RLS and must
-- explicitly scope by user_id in queries.
```

## Strava OAuth flow

1. `/settings` shows "Connect Strava" if no `strava_account` row for current user.
2. Click → redirect to
   `https://www.strava.com/oauth/authorize?client_id=...&redirect_uri=<APP>/api/strava/oauth&response_type=code&scope=read,activity:read_all&approval_prompt=force`.
3. Strava redirects back to `/api/strava/oauth?code=...`.
4. Server exchanges code at `https://www.strava.com/oauth/token` → upserts
   `strava_account` keyed by current `auth.uid()`.
5. Redirect to `/settings` with success state.

Refresh logic lives in `lib/strava/client.ts`: before each API call, if
`token_expires_at < now() + 60s`, refresh and persist new tokens.

## Strava webhook flow

**One-time subscription registration** (run `scripts/strava-subscribe.ts`
once per environment — dev vs. prod):

```
POST https://www.strava.com/api/v3/push_subscriptions
  callback_url=<APP>/api/strava/webhook
  verify_token=<STRAVA_WEBHOOK_VERIFY_TOKEN>
```

**GET /api/strava/webhook** — Strava's verification challenge:
- Compare `hub.verify_token` to env var.
- Echo back `{"hub.challenge": "..."}`.

**POST /api/strava/webhook** — Strava requires a response within ~2s:
1. Insert raw event to `strava_webhook_events` immediately.
2. Branch on `aspect_type`:
   - `create` / `update` → fetch full activity, if `type === 'Run'`,
     transform + upsert into `activities`.
   - `delete` → delete from `activities` by id.
   - `athlete` + `updates.authorized=false` → mark account revoked.
3. Return 200 unconditionally. Store any `processing_error` for retry.

Processing is synchronous within the request (typical Strava API call is
200-400ms, well under both the 2s Strava deadline and Vercel free-tier 10s
function limit).

## Backfill

`scripts/strava-backfill.ts` (local only, via `pnpm tsx`):
- Reads user + tokens from Supabase via service-role key.
- Pages `GET /athlete/activities?per_page=200&after=<unix>` until desired
  history is covered (default: 12 months).
- Filters `type === 'Run'`, upserts. ~150-300 runs = 1-2 list calls. No
  per-activity detail fetch needed — list response has everything.

## Export endpoint

`GET /api/export?token=<raw>`:
- `sha256(raw)` → look up `export_tokens` where `revoked = false`.
- On miss, return 404 (don't differentiate from "no token").
- On hit, set `last_used_at`, return JSON:
  ```
  { generated_at, user: { email }, activities: [...], daily_logs: [...] }
  ```
- `Cache-Control: no-store`.
- Tokens generated server-side (`crypto.randomBytes(32).toString('hex')`),
  shown once on `/settings`.

## Auth model

- Supabase magic link only.
- `lib/auth/allowlist.ts` checks
  `session.user.email === process.env.ALLOWED_EMAIL`. If not, sign out
  + redirect to `/login?denied=1`.
- `middleware.ts` protects `/`, `/log`, `/settings`. Public:
  `/login`, `/auth/callback`, `/api/strava/webhook`, `/api/export`.

## Charts (Recharts)

| Chart | Source query |
|---|---|
| Weekly mileage (bar, last 16 weeks) | `activities` grouped by Mon-Sun week in Europe/Amsterdam, sum `distance_m / 1000` |
| Recent activities (table, last 20) | `activities order by start_at desc limit 20` |
| Pace trend (line, last 90d) | per-activity `1000 / average_speed_mps / 60`; optional 7-run rolling avg |
| Sleep vs energy (scatter) | `daily_log`; x=`sleep_hours`, y=`energy`, size=`sleep_score` |

HR-zones-over-time is in the goal list but out of MVP (we chose "summary
stats only"). Schema supports adding `hr_zone_seconds jsonb` later without
migration pain.

## Milestones

**Week 1 — Foundation + ingest plumbing**
- M1. Repo scaffold: Next.js + Tailwind + Supabase clients + env wiring +
  Vercel deploy with magic-link auth gate working.
- M2. Schema migrated; allowlist enforced end-to-end.
- M3. Strava OAuth connect flow end-to-end; refresh logic tested.
- M4. Backfill script runs locally; 12 months of runs in `activities`.

**Week 2 — Real-time sync + dashboard core**
- M5. Webhook endpoint live behind Cloudflare Tunnel; verify + ingest a
  real activity end-to-end. Subscription swapped to Vercel prod URL.
- M6. Weekly mileage chart + recent activities table on `/`.
- M7. Pace trend chart.

**Week 3 — Logging, export, polish**
- M8. Daily log form: upsert by `(user_id, log_date)`.
- M9. Sleep vs energy scatter on dashboard.
- M10. Export endpoint + token generation UI (shown once, hash stored,
  revoke button).
- M11. Cut over Strava subscription to prod, double-check env vars,
  smoke test from a fresh browser.

## Risks

1. **One Strava push subscription per API app.** Register a second Strava
   API app for prod (free, ~5 min) or swap the subscription URL between
   dev and prod.
2. **Webhook events delivered once.** Always write raw payload to
   `strava_webhook_events` before processing; add a "Resync last N days"
   button on `/settings`.
3. **Vercel free-tier 10s function limit.** Webhook handler is fine.
   Backfill is local-only — never expose it as a route.
4. **Refresh token rotation races.** Unlikely for one user; wrap refresh
   in `select ... for update` on `strava_account` if it ever happens.
5. **Supabase free tier 7-day inactive pause.** Webhook keeps it warm.
6. **Timezones.** Europe/Amsterdam, Mon-Sun, single source of truth in
   `lib/time/week.ts`.
7. **Export token in URL.** Treat as a password; rotate if pasted in
   shareable places. Hashed-storage supports rotation cleanly.
8. **Magic link + mobile in-app browsers.** Gmail's in-app browser
   sometimes breaks cookie roundtrips. Test on phone before relying.
9. **Samsung Health sleep score is manual.** No clean public API.
10. **No tests in MVP.** Mitigation: `strict: true` in tsconfig + a
    `tsc --noEmit` step in pre-push.
11. **AI-attribution discipline.** `.claude/` and `CLAUDE.md` in
    `.gitignore` from M1. Commits stay plain.

## Environment variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server-only

# Strava
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_WEBHOOK_VERIFY_TOKEN=        # random string

# App
ALLOWED_EMAIL=gekgekke@gmail.com
NEXT_PUBLIC_APP_URL=                # https://<app>.vercel.app
```

## Verification

- **Auth gate:** Allowed email signs in → dashboard. Other email → bounced.
- **Strava OAuth:** Connect on `/settings`; `strava_account` row populated.
- **Backfill:** `pnpm tsx scripts/strava-backfill.ts`; row count matches Strava.
- **Webhook end-to-end:** Record a phone run; row appears in
  `strava_webhook_events` then `activities`. Edit name in Strava; row updates.
- **Daily log:** Submit; refresh; same values. Submit again; row upserts.
- **Charts:** Weekly mileage matches Strava weekly totals. Pace trend
  populates. Sleep-vs-energy scatter populates after a few logs.
- **Export:** Generate token; `curl <APP>/api/export?token=<raw>` returns JSON;
  `last_used_at` updates. Revoke; same URL returns 404.
- **Deployment:** Prod URL in private window; auth wall; sign-in works.
