// Pre-computed metrics included in /api/export so analysis sessions don't
// re-derive (and disagree). Pure functions, no DB calls — caller passes the
// filtered activity rows.
//
// Inputs already exclude source='inferred' rows by convention; caller is
// responsible for that filter (kept here so the function is reusable).

import { classifyRuns, type RunInput } from './classify'
import { ymdInAmsterdam } from '@/lib/time/week'

// Anatomically plausible cap when filtering max_heartrate samples for the
// "personal max" estimate. Strava + watch sensors regularly spike to 200s
// briefly; values above this are treated as artefacts.
const MAX_HR_CEILING = 215
// Minimum max_heartrate to count as a real read (filters obvious 0s and
// post-pause garbage).
const MAX_HR_FLOOR = 100
// Fallback when there aren't enough HR-tagged runs to estimate personal max.
const DEFAULT_PERSONAL_MAX_HR = 190

// Easy/hard split threshold as a fraction of personal_max_bpm. 0.80 is the
// conventional zone-2 ceiling: avg HR at or below this counts as easy time,
// anything above counts as moderate-or-harder. (The previous 0.75 was too
// low — that's roughly LT1 / aerobic-base, not the easy↔hard cutoff.)
const EASY_HARD_THRESHOLD_FRACTION = 0.8

// Same-day fragment detection: two activities on the same Amsterdam
// calendar date, starting within this many seconds of each other, where
// one is below this distance are treated as one outing split in two. The
// smaller activity is excluded from derived metrics so it doesn't inflate
// run count, easy time, or weekly volume sums (raw rows stay untouched).
const FRAGMENT_MAX_GAP_S = 3 * 3600
const FRAGMENT_MAX_DISTANCE_M = 10000

export interface ActivityForDerived {
  start_at: string
  distance_m: number
  moving_time_s: number
  type: string
  has_heartrate: boolean
  average_heartrate: number | null
  max_heartrate: number | null
  average_speed_mps: number | null
  source?: string | null
}

export interface DerivedMetrics {
  weekly_km_7d: number | null
  weekly_km_28d: number | null
  acwr_7_28: number | null
  easy_hard_split_28d_pct: {
    easy: number
    hard: number
    basis: 'hr' | 'pace'
    personal_max_bpm?: number
    threshold_bpm?: number
  } | null
  longest_run_per_week_km: { week_start: string; km: number }[]
  riegel_predicted_marathon_s: number | null
  riegel_basis: {
    activity_start_at: string
    distance_m: number
    moving_time_s: number
  } | null
  days_to_primary_race: number | null
}

function mondayUtcYmd(d: Date): string {
  const day = d.getUTCDay()
  const offset = (day + 6) % 7
  const m = new Date(d)
  m.setUTCDate(d.getUTCDate() - offset)
  return m.toISOString().slice(0, 10)
}

// Date window in Europe/Amsterdam calendar days. `days=7` means the
// last 7 calendar days *including today* — so a morning run on the
// 7th-day-ago is included even if the export is generated in the evening.
// Time-of-day no longer affects which runs fall in or out of the window.
function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function inLastNCalendarDays(
  activityIso: string,
  todayAmsYmd: string,
  days: number,
): boolean {
  const cutoff = addDaysYmd(todayAmsYmd, -(days - 1))
  const actYmd = ymdInAmsterdam(new Date(activityIso))
  return actYmd >= cutoff && actYmd <= todayAmsYmd
}

// 95th percentile of a numeric array (sorted ascending). Returns null on
// empty input. Used to estimate "personal max" HR robustly without letting
// one sensor spike (e.g. a transient 211 bpm reading) anchor the threshold.
function percentile95(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const idx = Math.ceil(sorted.length * 0.95) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]
}

function sumKm(activities: ActivityForDerived[]): number {
  return activities.reduce((s, a) => s + (a.distance_m ?? 0), 0) / 1000
}

// Identify same-day fragments. Two activities on the same Amsterdam date,
// starting within FRAGMENT_MAX_GAP_S of each other, smaller one shorter
// than FRAGMENT_MAX_DISTANCE_M → the smaller one is the fragment. Returns
// a Set of start_at strings to exclude. Returning start_at instead of a
// fabricated key keeps the caller's filter explicit (no shared makeKey).
function detectFragments(runs: ActivityForDerived[]): Set<string> {
  const byDay = new Map<string, ActivityForDerived[]>()
  for (const r of runs) {
    const day = ymdInAmsterdam(new Date(r.start_at))
    const list = byDay.get(day) ?? []
    list.push(r)
    byDay.set(day, list)
  }
  const exclude = new Set<string>()
  for (const list of byDay.values()) {
    if (list.length < 2) continue
    // Pairwise — if more than 2 share a day, every pair is checked, and
    // only fragments (small + close-in-time) are marked.
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        const gap = Math.abs(
          new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
        ) / 1000
        if (gap > FRAGMENT_MAX_GAP_S) continue
        const smaller = a.distance_m <= b.distance_m ? a : b
        if (smaller.distance_m >= FRAGMENT_MAX_DISTANCE_M) continue
        exclude.add(smaller.start_at)
      }
    }
  }
  return exclude
}

export function deriveMetrics(
  activities: ActivityForDerived[],
  now: Date,
  primaryEventDate: string | null,
): DerivedMetrics {
  const rawRuns = activities.filter(
    a => a.type === 'Run' && (a.source ?? 'synced') !== 'inferred',
  )
  const fragmentExcludes = detectFragments(rawRuns)
  const runs = rawRuns.filter(r => !fragmentExcludes.has(r.start_at))
  const nowMs = now.getTime()
  const todayAms = ymdInAmsterdam(now)

  const runs7d = runs.filter(a => inLastNCalendarDays(a.start_at, todayAms, 7))
  const runs28d = runs.filter(a => inLastNCalendarDays(a.start_at, todayAms, 28))

  const km7 = Number(sumKm(runs7d).toFixed(2))
  const km28 = Number(sumKm(runs28d).toFixed(2))

  // ACWR: acute (last 7d) vs chronic (avg of last 28d -> per-week baseline).
  // Standard definition: chronic = (km in last 28d) / 4. ACWR = acute / chronic.
  // 0.8-1.3 is the typical "safe" band.
  let acwr: number | null = null
  if (km28 > 0) {
    const chronic = km28 / 4
    if (chronic > 0) acwr = Number((km7 / chronic).toFixed(2))
  }

  // Easy/hard split over the last 28d, weighted by moving_time_s.
  // Prefer HR when at least 5 of the 28d runs carry HR + we can derive a
  // personal max. Threshold = 75% of personal max ~ top of zone 2.
  let split: DerivedMetrics['easy_hard_split_28d_pct'] = null
  if (runs28d.length > 0) {
    const hrRuns = runs28d.filter(
      r => r.has_heartrate && typeof r.average_heartrate === 'number',
    )
    const useHr = hrRuns.length >= 5
    let easyS = 0
    let hardS = 0
    if (useHr) {
      // Personal-max estimate from the 95th percentile of plausible
      // max_heartrate readings across all runs. The 100/215 bounds drop
      // sensor spikes and post-pause zeros at the value level; the p95
      // (vs raw max) drops one-off outliers. Earlier code also filtered
      // by date to exclude pre-arm-band wrist data, but that produced
      // an under-estimate when the recent window happened to contain no
      // max-effort runs — sample-quality bounds are enough.
      const cleanMaxHr = runs
        .map(r => r.max_heartrate ?? 0)
        .filter(v => v >= MAX_HR_FLOOR && v <= MAX_HR_CEILING)
        .sort((a, b) => a - b)
      const personalMax = percentile95(cleanMaxHr) ?? DEFAULT_PERSONAL_MAX_HR
      const threshold = personalMax * EASY_HARD_THRESHOLD_FRACTION
      for (const r of runs28d) {
        const time = r.moving_time_s ?? 0
        if (
          r.has_heartrate &&
          typeof r.average_heartrate === 'number' &&
          r.average_heartrate > 0
        ) {
          if (r.average_heartrate <= threshold) easyS += time
          else hardS += time
        } else {
          // No HR on this row — treat as easy. We're already in the HR
          // branch because >=5 other rows do have HR, so partial coverage
          // is the common case.
          easyS += time
        }
      }
      const total = easyS + hardS
      if (total > 0) {
        split = {
          easy: Number(((easyS / total) * 100).toFixed(1)),
          hard: Number(((hardS / total) * 100).toFixed(1)),
          basis: 'hr',
          personal_max_bpm: Math.round(personalMax),
          threshold_bpm: Math.round(threshold),
        }
      }
    } else {
      // Pace-based via heuristic classifier.
      const classes = classifyRuns(runs28d.map(toRunInput))
      for (const r of runs28d) {
        const key = makeKey(r)
        const type = classes.get(key)
        const time = r.moving_time_s ?? 0
        if (type === 'tempo' || type === 'race') hardS += time
        else easyS += time
      }
      const total = easyS + hardS
      if (total > 0) {
        split = {
          easy: Number(((easyS / total) * 100).toFixed(1)),
          hard: Number(((hardS / total) * 100).toFixed(1)),
          basis: 'pace',
        }
      }
    }
  }

  // Longest run per week — last 12 ISO weeks (Mon UTC bucketing).
  const cutoff = nowMs - 12 * 7 * 86_400_000
  const longestByWeek = new Map<string, number>()
  for (const r of runs) {
    const t = new Date(r.start_at).getTime()
    if (t < cutoff) continue
    const wk = mondayUtcYmd(new Date(r.start_at))
    const km = (r.distance_m ?? 0) / 1000
    longestByWeek.set(wk, Math.max(longestByWeek.get(wk) ?? 0, km))
  }
  const longest = [...longestByWeek.entries()]
    .map(([week_start, km]) => ({
      week_start,
      km: Number(km.toFixed(2)),
    }))
    .sort((a, b) => (a.week_start < b.week_start ? -1 : 1))

  // Riegel prediction from best recent effort >= 5km in the last 90 days.
  // T2 = T1 * (D2/D1)^1.06. Find the run with the fastest pace among
  // distance >= 5000 m.
  const ninetyAgo = nowMs - 90 * 86_400_000
  let best: ActivityForDerived | null = null
  let bestPace = Infinity
  for (const r of runs) {
    if (new Date(r.start_at).getTime() < ninetyAgo) continue
    if ((r.distance_m ?? 0) < 5000) continue
    if (!r.moving_time_s || r.moving_time_s <= 0) continue
    const pace = r.moving_time_s / r.distance_m // s/m
    if (pace < bestPace) {
      bestPace = pace
      best = r
    }
  }
  let predicted: number | null = null
  let riegelBasis: DerivedMetrics['riegel_basis'] = null
  if (best) {
    const t = best.moving_time_s * Math.pow(42195 / best.distance_m, 1.06)
    predicted = Math.round(t)
    riegelBasis = {
      activity_start_at: best.start_at,
      distance_m: best.distance_m,
      moving_time_s: best.moving_time_s,
    }
  }

  // Days to primary race.
  let dtr: number | null = null
  if (primaryEventDate && /^\d{4}-\d{2}-\d{2}$/.test(primaryEventDate)) {
    const todayYmd = now.toISOString().slice(0, 10)
    const [fy, fm, fd] = todayYmd.split('-').map(Number)
    const [ty, tm, td] = primaryEventDate.split('-').map(Number)
    dtr = Math.round(
      (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
    )
  }

  return {
    weekly_km_7d: km7,
    weekly_km_28d: km28,
    acwr_7_28: acwr,
    easy_hard_split_28d_pct: split,
    longest_run_per_week_km: longest,
    riegel_predicted_marathon_s: predicted,
    riegel_basis: riegelBasis,
    days_to_primary_race: dtr,
  }
}

// `classifyRuns` keys runs by id (number) — synthesise one from start_at +
// distance so we can use it for activities that don't carry a numeric id
// in this codepath. The actual mapping doesn't matter as long as the
// caller uses the same `makeKey`.
function makeKey(a: ActivityForDerived): number {
  return new Date(a.start_at).getTime() + Math.round(a.distance_m)
}

function toRunInput(a: ActivityForDerived): RunInput {
  return {
    id: makeKey(a),
    start_at: a.start_at,
    distance_m: a.distance_m,
    average_speed_mps: a.average_speed_mps,
  }
}
