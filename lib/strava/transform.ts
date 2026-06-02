import {
  parseLaps,
  detectIntervalStructure,
  type CompactLap,
} from '../run/laps'

export interface StravaSummaryActivity {
  id: number
  athlete: { id: number }
  name: string
  type: string
  sport_type?: string
  distance: number
  moving_time: number
  elapsed_time: number
  total_elevation_gain: number | null
  average_heartrate: number | null
  max_heartrate: number | null
  average_speed: number
  max_speed: number
  has_heartrate: boolean
  start_date: string
  start_date_local: string
  timezone: string
  // Present only on the activity *detail* response (fetchActivityById), not on
  // the summary list. Parsed into compact splits + an interval-structure flag.
  laps?: unknown
  splits_standard?: unknown
}

export interface ActivityRow {
  id: number
  user_id: string
  athlete_id: number
  start_at: string
  start_at_local: string
  timezone: string
  name: string
  type: string
  distance_m: number
  moving_time_s: number
  elapsed_time_s: number
  total_elevation_gain_m: number | null
  average_heartrate: number | null
  max_heartrate: number | null
  average_speed_mps: number
  max_speed_mps: number
  has_heartrate: boolean
  laps: CompactLap[] | null
  interval_structure: boolean | null
  // Set by upsertIfRun from the HR stream (separate API call), not by the
  // pure transform. Omitted on the summary-list path (resync / backfill).
  hr_above_tempo_pct?: number | null
  raw: unknown
  updated_at: string
}

// Anatomically implausible HR ceiling. Wrist watches occasionally report
// values like 211+ bpm during cold weather or strap shifts; we drop those
// on the way in so downstream metrics aren't poisoned. The raw payload is
// still persisted under `raw` for forensics.
const MAX_HR_CEILING = 215

function sanitiseMaxHr(v: number | null): number | null {
  if (v === null || v === undefined) return null
  if (!Number.isFinite(v)) return null
  if (v > MAX_HR_CEILING) return null
  return v
}

export function transformActivity(
  a: StravaSummaryActivity,
  userId: string,
): ActivityRow {
  // laps/splits exist only on the detail payload. parseLaps returns null for
  // summary rows (resync / backfill) and for runs with a single whole-run lap.
  const laps = parseLaps(a)
  return {
    id: a.id,
    user_id: userId,
    athlete_id: a.athlete.id,
    start_at: a.start_date,
    // Strava sends start_date_local with a trailing 'Z' even though it's
    // local clock time. Strip it so Postgres reads a naive timestamp.
    start_at_local: a.start_date_local.replace(/Z$/, ''),
    timezone: a.timezone,
    name: a.name,
    type: a.type,
    distance_m: a.distance,
    moving_time_s: a.moving_time,
    elapsed_time_s: a.elapsed_time,
    total_elevation_gain_m: a.total_elevation_gain,
    average_heartrate: a.average_heartrate,
    max_heartrate: sanitiseMaxHr(a.max_heartrate),
    average_speed_mps: a.average_speed,
    max_speed_mps: a.max_speed,
    has_heartrate: a.has_heartrate ?? false,
    laps,
    interval_structure: laps ? detectIntervalStructure(laps) : null,
    raw: a,
    updated_at: new Date().toISOString(),
  }
}
