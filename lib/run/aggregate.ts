import { addWeeks, weekStartFromStartAt } from '@/lib/time/week'

export type LoadZone = 'build' | 'neutral' | 'spike' | 'cut' | 'now'

export interface WeekBucket {
  weekStart: string // YYYY-MM-DD (Monday)
  km: number
  runs: number
  longestM: number
  zone: LoadZone
}

interface ActivityInput {
  start_at: string
  distance_m: number
  average_speed_mps?: number | null
  average_heartrate?: number | null
  moving_time_s?: number
}

// Build a continuous list of weeks (oldest -> current). The most recent
// entry is always the current week, regardless of whether any run has
// happened yet. WoW % is computed against the previous *finished* week.
export function weeklyBuckets(
  activities: ActivityInput[],
  weeks: number,
  currentMonday: string,
): WeekBucket[] {
  const start = addWeeks(currentMonday, -(weeks - 1))
  const empty = (weekStart: string): WeekBucket => ({
    weekStart,
    km: 0,
    runs: 0,
    longestM: 0,
    zone: 'neutral',
  })

  const buckets: WeekBucket[] = []
  for (let i = 0; i < weeks; i++) {
    buckets.push(empty(addWeeks(start, i)))
  }
  const byStart = new Map(buckets.map(b => [b.weekStart, b]))

  for (const a of activities) {
    const wk = weekStartFromStartAt(a.start_at)
    const bucket = byStart.get(wk)
    if (!bucket) continue
    bucket.km += a.distance_m / 1000
    bucket.runs += 1
    if (a.distance_m > bucket.longestM) bucket.longestM = a.distance_m
  }

  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]
    b.km = Number(b.km.toFixed(2))
    if (b.weekStart === currentMonday) {
      b.zone = 'now'
      continue
    }
    const prev = i > 0 ? buckets[i - 1].km : 0
    if (b.km === 0 && prev === 0) {
      b.zone = 'neutral'
    } else if (prev === 0 && b.km > 0) {
      b.zone = 'build'
    } else {
      const delta = (b.km - prev) / prev
      if (delta > 0.1) b.zone = 'spike'
      else if (delta < -0.1) b.zone = 'cut'
      else if (delta > 0) b.zone = 'build'
      else b.zone = 'neutral'
    }
  }

  return buckets
}

export function pctChange(curr: number, prev: number): number | null {
  if (prev <= 0) return null
  return ((curr - prev) / prev) * 100
}

export function sumKm(activities: ActivityInput[]): number {
  return activities.reduce((acc, a) => acc + a.distance_m / 1000, 0)
}

export function avgEasyPaceMinPerKm(
  activities: ActivityInput[],
): number | null {
  // Easy = within 10% of the slowest 60% of the week's runs by pace.
  // Heuristic. Returns minutes per km.
  const paces = activities
    .map(a => (a.average_speed_mps ? 1000 / a.average_speed_mps / 60 : null))
    .filter((p): p is number => p !== null && isFinite(p))
  if (paces.length === 0) return null
  paces.sort((a, b) => b - a) // slowest first
  const slowSlice = paces.slice(0, Math.max(1, Math.ceil(paces.length * 0.6)))
  const avg = slowSlice.reduce((s, p) => s + p, 0) / slowSlice.length
  return avg
}

export function avgHr(activities: ActivityInput[]): number | null {
  const hrs = activities
    .map(a => a.average_heartrate ?? null)
    .filter((h): h is number => typeof h === 'number' && h > 0)
  if (hrs.length === 0) return null
  return hrs.reduce((s, h) => s + h, 0) / hrs.length
}
