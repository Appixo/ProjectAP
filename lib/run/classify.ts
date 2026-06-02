export type RunType =
  | 'easy'
  | 'recovery'
  | 'tempo'
  | 'threshold'
  | 'vo2'
  | 'long'
  | 'race'

// The full set of values the activities.run_type column accepts (matches the
// CHECK constraint in 20260518120000_audit_gaps.sql). Used to validate a
// persisted column value before trusting it as a RunType.
const RUN_TYPE_VALUES = new Set<RunType>([
  'easy',
  'recovery',
  'tempo',
  'threshold',
  'vo2',
  'long',
  'race',
])

// "Quality" = a deliberate hard/intensity stimulus. Used to (a) split easy vs
// hard load and (b) exclude these runs from the easy-pace average so a tempo
// or threshold session doesn't drag it faster. `long` is NOT quality here:
// it's volume, run at easy intensity. (The consistency chart groups long with
// the quality types for its *colour* split — that's a separate grouping.)
export const QUALITY_RUN_TYPES = new Set<RunType>([
  'tempo',
  'threshold',
  'vo2',
  'race',
])

export function isQualityType(t: RunType): boolean {
  return QUALITY_RUN_TYPES.has(t)
}

// Map a planned run_* modality to the run type we stamp on the matched
// activity. The plan is the source of truth — a planned threshold run that
// gets logged as an easy-paced average should still read "threshold".
const MODALITY_TO_RUN_TYPE: Record<string, RunType> = {
  run_easy: 'easy',
  run_recovery: 'recovery',
  run_tempo: 'tempo',
  run_threshold: 'threshold',
  run_vo2: 'vo2',
  run_long: 'long',
  run_race: 'race',
}

export function modalityToRunType(modality: string): RunType | null {
  return MODALITY_TO_RUN_TYPE[modality] ?? null
}

// Narrow a persisted activities.run_type string to a RunType, or null when the
// column is empty / holds an unexpected value. Callers use this to prefer the
// stored (plan-derived) type over the heuristic.
export function asRunType(v: string | null | undefined): RunType | null {
  return v != null && RUN_TYPE_VALUES.has(v as RunType) ? (v as RunType) : null
}

// HR tempo floor (bpm). Time at or above this counts as quality work in the
// HR-distribution rule. ~155 is roughly the top of zone 3 / threshold floor
// for this athlete; see lib/strava/streams.ts where the per-activity fraction
// is computed at ingest.
export const TEMPO_HR_FLOOR_BPM = 155

// If more than this fraction of moving time is spent at/above the tempo HR
// floor, the run carries a real quality stimulus and must not be tagged easy —
// regardless of how low the *average* HR looks (warm-up + jog recoveries pull
// the mean down on an interval session).
const HR_QUALITY_FRACTION = 0.15

export interface RunInput {
  id: number
  start_at: string
  distance_m: number
  average_speed_mps: number | null
  // Fraction (0-1) of moving time at/above TEMPO_HR_FLOOR_BPM, from the HR
  // stream. Undefined/null when no stream was ingested. (M2)
  hr_above_tempo_frac?: number | null
  // True when lap structure looks like an interval/threshold session: distinct
  // fast work segments separated by slower recoveries. (M3)
  interval_structure?: boolean | null
}

// Heuristic classification — schema doesn't store workout type, so we infer
// from distance + pace context. Boring and good-enough until manual tagging
// (or a workout label from Strava) is added.
//
// - long      : distance >= 12 km, OR is the longest run in a week that has
//               ≥ 2 runs AND is at least 1.5× the median distance for the
//               week (so a partial-week single run doesn't get promoted to
//               "long" just by being the only data point).
// - tempo     : avg pace is at least 8% faster than the week's median pace
//               (and not the long run)
// - recovery  : distance <= 5 km AND pace is at least 8% slower than median
// - easy      : default
export function classifyRuns(runs: RunInput[]): Map<number, RunType> {
  const byWeekId = new Map<string, RunInput[]>()
  for (const r of runs) {
    const wk = r.start_at.slice(0, 10) // group by ISO date; precise enough for week buckets
    const list = byWeekId.get(wk) ?? []
    list.push(r)
    byWeekId.set(wk, list)
  }
  // re-group by Mon-Sun week — approximate via 7-day window of start_at UTC date
  const byWeek = new Map<string, RunInput[]>()
  for (const r of runs) {
    const d = new Date(r.start_at)
    const dow = d.getUTCDay() // 0..6 Sun..Sat
    const offset = (dow + 6) % 7
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - offset)
    const key = monday.toISOString().slice(0, 10)
    const list = byWeek.get(key) ?? []
    list.push(r)
    byWeek.set(key, list)
  }

  const out = new Map<number, RunType>()
  for (const [, weekRuns] of byWeek) {
    const longest = weekRuns.reduce((a, b) =>
      a.distance_m >= b.distance_m ? a : b,
    )
    const speeds = weekRuns
      .map(r => r.average_speed_mps)
      .filter((s): s is number => typeof s === 'number' && s > 0)
      .sort((a, b) => a - b)
    const medianSpeed =
      speeds.length === 0
        ? null
        : speeds[Math.floor(speeds.length / 2)]

    // Median distance is computed on the same Mon-Sun window. Used to
    // gate the "longest-of-week is long" rule so a partial week with a
    // single shakeout doesn't get tagged as long.
    const distances = weekRuns
      .map(r => r.distance_m)
      .sort((a, b) => a - b)
    const medianDistance = distances[Math.floor(distances.length / 2)]
    const longestIsTrulyLong =
      weekRuns.length >= 2 && longest.distance_m >= medianDistance * 1.5

    for (const r of weekRuns) {
      let type: RunType = 'easy'
      const distKm = r.distance_m / 1000
      const speed = r.average_speed_mps ?? 0

      if (distKm >= 12 || (r.id === longest.id && longestIsTrulyLong)) {
        type = 'long'
      } else if (medianSpeed && speed > 0) {
        const ratio = speed / medianSpeed
        if (ratio >= 1.08) type = 'tempo'
        else if (ratio <= 0.92 && distKm <= 5) type = 'recovery'
      }

      // Quality overrides driven by intra-run structure, not the pace mean.
      // These only ever *upgrade* a run that pace alone read as easy/recovery;
      // a genuine long run keeps its label even if it finished with surges.
      // (classifyRuns never emits 'race' — that only arrives via a plan match.)
      if (type !== 'long') {
        if (r.interval_structure) {
          // Lap structure is the definitive interval signature → threshold.
          type = 'threshold'
        } else if (
          (type === 'easy' || type === 'recovery') &&
          typeof r.hr_above_tempo_frac === 'number' &&
          r.hr_above_tempo_frac > HR_QUALITY_FRACTION
        ) {
          // Significant time above the tempo floor with no lap detail — it's
          // quality work, but we can't tell tempo from threshold, so tempo.
          type = 'tempo'
        }
      }
      out.set(r.id, type)
    }
  }
  return out
}

export function paceMinPerKm(mps: number | null | undefined): number | null {
  if (!mps || mps <= 0) return null
  return 1000 / mps / 60
}

export function formatPace(minPerKm: number | null | undefined): string {
  if (minPerKm === null || minPerKm === undefined || !isFinite(minPerKm)) {
    return '—'
  }
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
