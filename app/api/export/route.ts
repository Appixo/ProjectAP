import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveApiAuth, touchTokenLastUsed } from '@/lib/auth/api-auth'
import { todayInAmsterdam } from '@/lib/time/week'
import { deriveMetrics, type ActivityForDerived } from '@/lib/run/derived'

const SHOE_HIGH_KM_FLAG = 600

function notFound() {
  return new NextResponse('Not found', { status: 404 })
}

interface GoalsRow {
  primary_goal: string
  primary_event_date: string | null
  secondary_goal: string | null
  secondary_event_date: string | null
  secondary_kind: string | null
  notes: string | null
  updated_at: string
}

interface ShoeRow {
  id: string
  brand: string | null
  model: string | null
  purchase_date: string | null
  retire_at_km: number
  retired_at: string | null
  created_at: string
  updated_at: string
}

interface ActivityRow extends ActivityForDerived {
  id: number
  start_at_local: string
  timezone: string | null
  name: string
  elapsed_time_s: number
  total_elevation_gain_m: number | null
  max_speed_mps: number | null
  rpe_1_10: number | null
  weather: unknown
  shoe_id: string | null
  surface: string | null
  run_type: string | null
}

function daysBetween(fromYmd: string, toYmd: string | null): number | null {
  if (!toYmd) return null
  const [fy, fm, fd] = fromYmd.split('-').map(Number)
  const [ty, tm, td] = toYmd.split('-').map(Number)
  const fromMs = Date.UTC(fy, fm - 1, fd)
  const toMs = Date.UTC(ty, tm - 1, td)
  return Math.round((toMs - fromMs) / 86400000)
}

// Field-level descriptor used in context.schema. Keeps unit and range
// explicit so an AI reader doesn't have to guess (e.g. distance_m is metres,
// not km).
const SCHEMA = {
  activities: {
    id: { type: 'integer', source: 'Strava activity id' },
    start_at: { type: 'string', format: 'ISO 8601 UTC' },
    start_at_local: { type: 'string', format: 'YYYY-MM-DDTHH:MM:SS (local wall clock)' },
    timezone: { type: 'string', example: 'Europe/Amsterdam' },
    name: { type: 'string' },
    type: { type: 'string', note: 'Strava type, e.g. Run, Ride' },
    distance_m: { type: 'number', unit: 'meters' },
    moving_time_s: { type: 'integer', unit: 'seconds' },
    elapsed_time_s: { type: 'integer', unit: 'seconds' },
    total_elevation_gain_m: { type: 'number', unit: 'meters' },
    average_heartrate: { type: 'number', unit: 'bpm' },
    max_heartrate: {
      type: 'number',
      unit: 'bpm',
      note: 'sanitised at ingest: values >215 bpm are dropped as sensor artefacts',
    },
    average_speed_mps: { type: 'number', unit: 'm/s' },
    max_speed_mps: { type: 'number', unit: 'm/s' },
    has_heartrate: { type: 'boolean' },
    rpe_1_10: { type: 'integer', range: '1-10', optional: true },
    weather: {
      type: 'object',
      shape: { temp_c: 'number', humidity_pct: 'number', wind_kph: 'number' },
      optional: true,
    },
    shoe_id: { type: 'uuid', references: 'shoes.id', optional: true },
    surface: { type: 'enum', values: ['road', 'trail', 'track', 'treadmill'], optional: true },
    run_type: {
      type: 'enum',
      values: ['easy', 'long', 'tempo', 'threshold', 'vo2', 'race', 'recovery'],
      optional: true,
    },
    source: {
      type: 'enum',
      values: ['logged', 'synced', 'inferred'],
      default: 'synced',
      note: "'synced' for Strava-imported rows; 'logged' for manual entries; 'inferred' for speculative rows excluded from derived metrics.",
    },
  },
  training_sessions: {
    id: { type: 'uuid' },
    session_at: { type: 'string', format: 'ISO 8601 UTC' },
    session_at_local: { type: 'string', format: 'YYYY-MM-DDTHH:MM:SS (local wall clock)' },
    timezone: { type: 'string' },
    modality: {
      type: 'enum',
      values: [
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
        'other',
      ],
      note: "Planned runs live here as run_* modalities; the actual Strava activity (when synced) sits in `activities` and is linked back via matched_activity_id.",
    },
    duration_min: { type: 'integer', range: '1-600', optional: true },
    rpe: { type: 'integer', range: '1-10', optional: true },
    format: { type: 'string', max_length: 80, optional: true },
    notes: { type: 'string', max_length: 4000, optional: true },
    source: { type: 'enum', values: ['logged', 'synced', 'inferred'], default: 'logged' },
    status: {
      type: 'enum',
      values: ['planned', 'completed', 'skipped'],
      default: 'completed',
      note: "Planned workouts ahead of today are 'planned'; past workouts are 'completed' or 'skipped'.",
    },
    description: {
      type: 'object',
      shape: {
        target_distance_km: 'number',
        target_duration_min: 'integer 1-600',
        target_hr_min: 'integer 60-220',
        target_hr_max: 'integer 60-220',
        target_pace_s_per_km_min: 'integer 120-900 (seconds per km, lower bound = faster)',
        target_pace_s_per_km_max: 'integer 120-900',
        reason: 'string up to 500 chars — one-line rationale',
      },
      optional: true,
      note: 'Plan metadata. Set on planned workouts so the dashboard tooltip + AI coach reading the export both see the prescription.',
    },
    matched_activity_id: {
      type: 'integer',
      references: 'activities.id',
      optional: true,
      note: 'For completed planned runs: links to the Strava activity that fulfilled the plan. Set by the webhook handler when a same-day matching run syncs.',
    },
  },
  daily_logs: {
    log_date: { type: 'string', format: 'YYYY-MM-DD' },
    sleep_hours: { type: 'number', unit: 'hours', range: '0-24', optional: true },
    sleep_quality_1_5: { type: 'integer', range: '1-5', optional: true },
    bedtime: { type: 'string', format: 'HH:MM[:SS] (local)', optional: true },
    wake_time: { type: 'string', format: 'HH:MM[:SS] (local)', optional: true },
    morning_rhr_bpm: { type: 'integer', unit: 'bpm', range: '20-200', optional: true },
    hrv_ms: { type: 'integer', unit: 'ms', range: '1-500', optional: true },
    soreness: {
      type: 'array',
      shape: {
        area:
          'enum: calves, hamstrings, quads, glutes, hip_flexors, lower_back, shins, feet, ankles, knees, achilles, it_band, other',
        score_1_5: 'integer 1-5',
      },
      optional: true,
      note: 'controlled vocabulary on area — use exactly one of the listed values to avoid fragmenting trend analysis',
    },
    water_l: { type: 'number', unit: 'litres', range: '0-20', optional: true },
    caffeine_mg: { type: 'integer', unit: 'mg', range: '0-2000', optional: true },
    caffeine_last_at: { type: 'string', format: 'ISO 8601 UTC', optional: true },
    alcohol_units: { type: 'number', range: '0-50', optional: true },
    body_weight_kg: { type: 'number', unit: 'kg', range: '20-250', optional: true },
    mood_1_5: { type: 'integer', range: '1-5', optional: true },
    stress_1_5: { type: 'integer', range: '1-5', optional: true },
    notes: { type: 'string', optional: true },
    sleep_score: {
      type: 'integer',
      range: '0-100',
      optional: true,
      note: 'legacy field — Samsung Health sleep score',
    },
    energy: { type: 'integer', range: '1-5', optional: true, note: 'legacy field' },
    habit_strength_done: { type: 'boolean', optional: true, note: 'legacy field' },
    habit_no_alcohol: { type: 'boolean', optional: true, note: 'legacy field' },
    habit_in_bed_on_time: { type: 'boolean', optional: true, note: 'legacy field' },
    source: { type: 'enum', values: ['logged', 'synced', 'inferred'], default: 'logged' },
  },
  shoes: {
    id: { type: 'uuid' },
    brand: { type: 'string', optional: true },
    model: { type: 'string', optional: true },
    purchase_date: { type: 'string', format: 'YYYY-MM-DD', optional: true },
    retire_at_km: {
      type: 'number',
      unit: 'km',
      default: 700,
      note: `kilometres at which the shoe should be retired. The over_threshold_km flag fires earlier (at ${SHOE_HIGH_KM_FLAG} km) as an early-warning band before full retirement.`,
    },
    retired_at: { type: 'string', format: 'ISO 8601 UTC', optional: true },
    current_km: {
      type: 'number',
      unit: 'km',
      note: 'computed: sum of activities.distance_m for this shoe / 1000',
    },
    over_threshold_km: {
      type: 'boolean',
      note: `true when current_km > ${SHOE_HIGH_KM_FLAG}`,
    },
    over_retire_km: { type: 'boolean', note: 'true when current_km > retire_at_km' },
  },
  derived: {
    weekly_km_7d: {
      type: 'number',
      unit: 'km',
      window: 'last 7 calendar days in Europe/Amsterdam, inclusive of today',
    },
    weekly_km_28d: {
      type: 'number',
      unit: 'km',
      window: 'last 28 calendar days in Europe/Amsterdam, inclusive of today',
    },
    acwr_7_28: {
      type: 'number',
      note: 'acute:chronic workload ratio = weekly_km_7d / (weekly_km_28d / 4). 0.8-1.3 typical "safe" band.',
    },
    easy_hard_split_28d_pct: {
      type: 'object',
      shape: {
        easy: 'number (pct of moving_time_s, last 28d)',
        hard: 'number (pct of moving_time_s, last 28d)',
        basis: 'enum: hr (>=5 runs with HR, threshold = 80% of personal_max_bpm) | pace (heuristic classifier)',
        personal_max_bpm:
          'integer, only when basis=hr — 95th percentile of plausible max_heartrate readings across all runs. Values <100 or >215 bpm dropped as artefacts at the sample level; the 95th percentile (vs raw max) makes the estimate robust to one-off sensor spikes without needing a date filter.',
        threshold_bpm:
          'integer, only when basis=hr — 80% of personal_max_bpm (zone-2 ceiling). avg_hr <= threshold counts as easy time, above as moderate-or-harder.',
      },
      window: 'last 28 calendar days in Europe/Amsterdam, inclusive of today',
    },
    longest_run_per_week_km: {
      type: 'array',
      shape: {
        week_start:
          'YYYY-MM-DD — Monday in UTC. Differs from context.week_starts (Amsterdam Monday) for runs starting in the first hour or two after local midnight; edge case only.',
        km: 'number',
      },
      note: 'last 12 weeks',
    },
    riegel_predicted_marathon_s: {
      type: 'integer',
      unit: 'seconds',
      note: 'Riegel formula T2 = T1 * (D2/D1)^1.06, applied to fastest pace among recent runs >= 5 km in last 90 days (uses moving_time_s, not elapsed). 5 km is the minimum; research-defensible floor for marathon extrapolation is 10 km — interpret short-distance predictions as fitness ceilings, not race times.',
    },
    riegel_basis: {
      type: 'object',
      shape: { activity_start_at: 'ISO 8601', distance_m: 'number', moving_time_s: 'integer' },
      optional: true,
    },
    days_to_primary_race: { type: 'integer' },
  },
  notes: {
    inferred_rows:
      "Rows with source='inferred' are speculative (e.g. system-filled) and are excluded from context.derived metrics until promoted to source='logged'.",
    same_day_fragments:
      "When Strava records one outing as two activities (watch died mid-run, phone restart, or paused-and-resumed) — same Amsterdam calendar day, started within 3 hours of each other, smaller activity under 10 km — the smaller is treated as a fragment and excluded from context.derived metrics. Both raw rows still appear in the activities array.",
  },
} as const

export async function GET(request: NextRequest) {
  const auth = await resolveApiAuth(request)
  if (!auth) return notFound()
  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  const admin = createSupabaseAdminClient()

  const [
    { data: activities },
    { data: dailyLogs },
    { data: trainingSessions },
    { data: goalsRow },
    { data: shoes },
    { data: user },
  ] = await Promise.all([
    admin
      .from('activities')
      .select(
        'id, start_at, start_at_local, timezone, name, type, distance_m, ' +
          'moving_time_s, elapsed_time_s, total_elevation_gain_m, ' +
          'average_heartrate, max_heartrate, average_speed_mps, max_speed_mps, ' +
          'has_heartrate, rpe_1_10, weather, shoe_id, surface, run_type, source',
      )
      .eq('user_id', auth.userId)
      .order('start_at', { ascending: false })
      .returns<ActivityRow[]>(),
    admin
      .from('daily_log')
      .select(
        'log_date, sleep_hours, sleep_quality_1_5, bedtime, wake_time, ' +
          'morning_rhr_bpm, hrv_ms, soreness, water_l, caffeine_mg, ' +
          'caffeine_last_at, alcohol_units, body_weight_kg, mood_1_5, ' +
          'stress_1_5, notes, sleep_score, energy, habit_strength_done, ' +
          'habit_no_alcohol, habit_in_bed_on_time, source',
      )
      .eq('user_id', auth.userId)
      .order('log_date', { ascending: false }),
    admin
      .from('training_sessions')
      .select(
        'id, session_at, session_at_local, timezone, modality, ' +
          'duration_min, rpe, format, notes, source, status, description, ' +
          'matched_activity_id',
      )
      .eq('user_id', auth.userId)
      .order('session_at', { ascending: false }),
    admin
      .from('goals')
      .select(
        'primary_goal, primary_event_date, secondary_goal, ' +
          'secondary_event_date, secondary_kind, notes, updated_at',
      )
      .eq('user_id', auth.userId)
      .maybeSingle<GoalsRow>(),
    admin
      .from('shoes')
      .select(
        'id, brand, model, purchase_date, retire_at_km, retired_at, created_at, updated_at',
      )
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .returns<ShoeRow[]>(),
    admin.auth.admin.getUserById(auth.userId),
  ])

  const today = todayInAmsterdam()
  const now = new Date()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin

  // Per-shoe distance roll-up for the shoes payload + over-threshold flag.
  const metersByShoe = new Map<string, number>()
  for (const a of activities ?? []) {
    if (!a.shoe_id) continue
    metersByShoe.set(a.shoe_id, (metersByShoe.get(a.shoe_id) ?? 0) + (a.distance_m ?? 0))
  }
  const shoesEnriched = (shoes ?? []).map(s => {
    const km = Number(((metersByShoe.get(s.id) ?? 0) / 1000).toFixed(2))
    return {
      ...s,
      current_km: km,
      over_threshold_km: km > SHOE_HIGH_KM_FLAG,
      over_retire_km: km > s.retire_at_km,
    }
  })
  const anyShoeOverThreshold = shoesEnriched.some(s => s.over_threshold_km)

  const derived = deriveMetrics(
    (activities ?? []).map(a => ({
      start_at: a.start_at,
      distance_m: a.distance_m,
      moving_time_s: a.moving_time_s,
      type: a.type,
      has_heartrate: a.has_heartrate,
      average_heartrate: a.average_heartrate,
      max_heartrate: a.max_heartrate,
      average_speed_mps: a.average_speed_mps,
      source: a.source,
    })),
    now,
    goalsRow?.primary_event_date ?? null,
  )

  // Build per-endpoint write URLs (only meaningful when caller has scope).
  // Re-bind to locals so nested closures see the narrowed (non-null) auth.
  const authSource = auth.source
  const authCanWrite = auth.canWrite
  const authRawToken = auth.rawToken
  function writeUrlFor(path: string): string | null {
    if (authSource === 'session' && authCanWrite) return `${appUrl}${path}`
    if (authSource === 'token' && authCanWrite && authRawToken) {
      return `${appUrl}${path}?token=${authRawToken}`
    }
    return null
  }
  function urlPatternFor(path: string): string {
    return authSource === 'session'
      ? `${appUrl}${path}`
      : `${appUrl}${path}?token=<WRITE_TOKEN>`
  }

  const context = {
    today,
    timezone: 'Europe/Amsterdam',
    week_starts: 'Monday',
    units: { distance: 'meters', pace: 'm/s', duration: 'seconds' },
    goals: goalsRow
      ? {
          primary_goal: goalsRow.primary_goal,
          primary_event_date: goalsRow.primary_event_date,
          days_to_primary_event: daysBetween(today, goalsRow.primary_event_date),
          secondary_goal: goalsRow.secondary_goal,
          secondary_event_date: goalsRow.secondary_event_date,
          secondary_kind: goalsRow.secondary_kind,
          days_to_secondary_event: daysBetween(
            today,
            goalsRow.secondary_event_date,
          ),
          notes: goalsRow.notes,
          updated_at: goalsRow.updated_at,
        }
      : null,
    auth: {
      source: auth.source,
      scope: auth.canWrite ? 'read+write' : 'read',
    },
    schema: SCHEMA,
    derived,
    flags: {
      shoes_over_600km: anyShoeOverThreshold,
    },
    write_endpoints: {
      sessions: {
        url: writeUrlFor('/api/sessions'),
        url_pattern: urlPatternFor('/api/sessions'),
        method: 'POST',
        content_type: 'application/json',
        accepts: 'single object OR array of objects (up to 100) — use the array form to upload a whole training plan at once',
        body_schema: {
          session_at_local:
            'string, YYYY-MM-DDTHH:MM in Europe/Amsterdam local time (required)',
          modality:
            'string, one of: strength_upper, strength_lower, strength_full, football, cycling, swimming, mobility, run_easy, run_tempo, run_long, run_threshold, run_vo2, run_race, run_recovery, rest, other (required)',
          duration_min: 'integer 1-600 (optional)',
          rpe: 'integer 1-10 (optional)',
          format: 'string up to 80 chars (optional)',
          notes: 'string up to 4000 chars (optional)',
          status:
            "string, one of: planned, completed, skipped (optional, default 'completed'). Use 'planned' for future plan rows.",
          description:
            'object (optional) — { target_distance_km, target_duration_min, target_hr_min, target_hr_max, target_pace_s_per_km_min, target_pace_s_per_km_max, reason }. See context.schema.training_sessions.description for full spec.',
        },
        example_body_single: {
          session_at_local: `${today}T18:30`,
          modality: 'football',
          duration_min: 50,
          rpe: 7,
          format: '6v6 2x25min',
          notes: 'Felt sharp in first half.',
        },
        example_body_batch_planned: [
          {
            session_at_local: `${today}T18:00`,
            modality: 'run_tempo',
            status: 'planned',
            description: {
              target_distance_km: 8,
              target_hr_min: 152,
              target_hr_max: 158,
              target_pace_s_per_km_min: 285,
              target_pace_s_per_km_max: 300,
              reason: 'First threshold stimulus in 5 weeks. 2 WU + 4 tempo + 2 CD.',
            },
          },
        ],
        notes: auth.canWrite
          ? "POST a JSON body matching body_schema. Send a single object for one session, or an array (max 100) to upload a planned block. Existing rows are not updated by POST — to revise a planned workout, hit the /log UI or (future) PATCH endpoint."
          : 'This token is read-only. Use a token with write scope, or call from the logged-in browser session.',
      },
      daily_logs: {
        url: writeUrlFor('/api/daily-logs'),
        url_pattern: urlPatternFor('/api/daily-logs'),
        method: 'POST',
        content_type: 'application/json',
        idempotent_on: 'date (upsert)',
        body_schema: {
          date: 'string, YYYY-MM-DD (required)',
          sleep_hours: 'number 0-24 (optional)',
          sleep_quality_1_5: 'integer 1-5 (optional)',
          bedtime: 'string HH:MM[:SS] (optional)',
          wake_time: 'string HH:MM[:SS] (optional)',
          morning_rhr_bpm: 'integer 20-200 (optional)',
          hrv_ms: 'integer 1-500 (optional)',
          soreness:
            'array of { area: string<=40 chars, score_1_5: int 1-5 } (optional)',
          water_l: 'number 0-20 (optional)',
          caffeine_mg: 'integer 0-2000 (optional)',
          caffeine_last_at: 'string ISO 8601 UTC (optional)',
          alcohol_units: 'number 0-50 (optional)',
          body_weight_kg: 'number 20-250 (optional)',
          mood_1_5: 'integer 1-5 (optional)',
          stress_1_5: 'integer 1-5 (optional)',
          notes: 'string up to 4000 chars (optional)',
        },
        example_body: {
          date: today,
          sleep_hours: 7.5,
          sleep_quality_1_5: 4,
          morning_rhr_bpm: 52,
          soreness: [{ area: 'calves', score_1_5: 2 }],
          mood_1_5: 4,
          notes: 'Solid easy day.',
        },
        notes: auth.canWrite
          ? 'POST upserts the row keyed on (user, date). Only provided fields are written; omitted fields preserve existing values.'
          : 'This token is read-only. Use a token with write scope, or call from the logged-in browser session.',
      },
      shoes: {
        url: writeUrlFor('/api/shoes'),
        url_pattern: urlPatternFor('/api/shoes'),
        method: 'POST',
        content_type: 'application/json',
        body_schema: {
          brand: 'string up to 60 chars (optional if model given)',
          model: 'string up to 80 chars (optional if brand given)',
          purchase_date: 'string YYYY-MM-DD (optional)',
          retire_at_km: 'number 1-5000 (optional, default 700)',
        },
        example_body: {
          brand: 'Asics',
          model: 'Novablast 5',
          purchase_date: today,
          retire_at_km: 700,
        },
        notes: auth.canWrite
          ? 'POST adds a shoe. GET /api/shoes lists shoes with computed current_km.'
          : 'This token is read-only. Use a token with write scope, or call from the logged-in browser session.',
      },
    },
  }

  return NextResponse.json(
    {
      generated_at: new Date().toISOString(),
      user: { email: user?.user?.email ?? null },
      context,
      activities: activities ?? [],
      training_sessions: trainingSessions ?? [],
      daily_logs: dailyLogs ?? [],
      shoes: shoesEnriched,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
