// Lap / split parsing + interval-structure detection. Pure functions — the
// caller passes a Strava activity detail (which carries `laps` and/or
// `splits_standard`) and gets back compact splits plus a boolean: does the
// lap-to-lap variance look like an interval/threshold session?
//
// A flat easy run has near-zero lap variance. A real interval session has
// distinct fast "work" laps separated by slower "recovery" laps — that
// structure is the definitive signature of quality work, independent of the
// average pace or HR (which warm-up + recoveries pull toward "easy").

export interface CompactLap {
  n: number
  distance_m: number
  moving_time_s: number
  average_speed_mps: number | null
  average_heartrate: number | null
  max_heartrate: number | null
}

// Subset of the Strava lap object we care about. `splits_standard` shares the
// distance/moving_time/average_speed/average_heartrate fields (no max_hr), so
// the same parser handles both.
interface StravaLapLike {
  distance?: number
  moving_time?: number
  average_speed?: number
  average_heartrate?: number | null
  max_heartrate?: number | null
  lap_index?: number
  split?: number
}

export interface ActivityWithLaps {
  laps?: unknown
  splits_standard?: unknown
}

// Prefer manual/auto `laps` (they reflect interval-button presses, so they
// align with work/recovery boundaries) over `splits_standard` (fixed 1 km
// splits, which blur a 400 m rep into its surrounding jog). Fall back to
// splits only when laps are absent or trivial (a single whole-run "lap").
export function parseLaps(activity: ActivityWithLaps): CompactLap[] | null {
  const laps = Array.isArray(activity.laps) ? (activity.laps as StravaLapLike[]) : null
  const splits = Array.isArray(activity.splits_standard)
    ? (activity.splits_standard as StravaLapLike[])
    : null
  const raw = laps && laps.length > 1 ? laps : splits && splits.length > 1 ? splits : null
  if (!raw) return null

  const out: CompactLap[] = raw.map((l, i) => ({
    n: l.lap_index ?? l.split ?? i + 1,
    distance_m: Math.round(l.distance ?? 0),
    moving_time_s: Math.round(l.moving_time ?? 0),
    average_speed_mps:
      typeof l.average_speed === 'number' && l.average_speed > 0
        ? Number(l.average_speed.toFixed(3))
        : null,
    average_heartrate:
      typeof l.average_heartrate === 'number' ? Math.round(l.average_heartrate) : null,
    max_heartrate:
      typeof l.max_heartrate === 'number' ? Math.round(l.max_heartrate) : null,
  }))
  return out.length > 1 ? out : null
}

function avgHr(laps: CompactLap[]): number | null {
  const hrs = laps
    .map(l => l.average_heartrate)
    .filter((h): h is number => typeof h === 'number' && h > 0)
  if (hrs.length === 0) return null
  return hrs.reduce((s, h) => s + h, 0) / hrs.length
}

// Coefficient of variation below which lap pacing is "flat" (steady run).
// Easy/long runs sit around 0.02–0.05; structured work pushes well past this.
const FLAT_CV = 0.07
// A lap counts as "work" when ≥6% faster than the median lap, "recovery" when
// ≥6% slower. The band in between is warm-up / cool-down / steady.
const WORK_RATIO = 1.06
const RECOVERY_RATIO = 0.94

export function detectIntervalStructure(laps: CompactLap[] | null): boolean {
  if (!laps) return false
  // Drop sub-200 m / sub-20 s fragments (auto-lap noise, final partial lap).
  const segs = laps.filter(
    l => l.distance_m >= 200 && l.moving_time_s >= 20 && (l.average_speed_mps ?? 0) > 0,
  )
  if (segs.length < 3) return false

  const speeds = segs.map(l => l.average_speed_mps as number)
  const sorted = [...speeds].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (median <= 0) return false

  const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length
  const variance = speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / speeds.length
  const cv = Math.sqrt(variance) / mean
  if (cv < FLAT_CV) return false

  const work = segs.filter(l => (l.average_speed_mps as number) >= median * WORK_RATIO)
  const recovery = segs.filter(l => (l.average_speed_mps as number) <= median * RECOVERY_RATIO)
  // Need at least two work bouts with recovery between them — a single fast
  // finish on an otherwise steady run is not an interval session.
  if (work.length < 2 || recovery.length < 1) return false

  // HR corroboration when present: work laps must run hotter than recovery
  // laps. Guards against a downhill-fast / uphill-slow steady run reading as
  // intervals purely on pace swings.
  const workHr = avgHr(work)
  const recHr = avgHr(recovery)
  if (workHr != null && recHr != null && workHr <= recHr) return false

  return true
}
