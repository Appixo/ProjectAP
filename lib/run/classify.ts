export type RunType = 'easy' | 'tempo' | 'long' | 'recovery' | 'race'

export interface RunInput {
  id: number
  start_at: string
  distance_m: number
  average_speed_mps: number | null
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
