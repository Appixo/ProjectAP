import { ymdInAmsterdam } from '@/lib/time/week'
import type { ActivityForDerived } from './derived'

// Standard distances we track personal bests for. Order is preserved by
// the iteration below so consumers can render them in this order.
const PB_DISTANCES = [
  { key: 'd_5k' as const, label: '5K', meters: 5_000 },
  { key: 'd_10k' as const, label: '10K', meters: 10_000 },
  { key: 'd_half' as const, label: 'Half marathon', meters: 21_097.5 },
  { key: 'd_full' as const, label: 'Marathon', meters: 42_195 },
]

// Accept runs whose recorded distance is up to 10% longer than the target
// (a "5K race" recorded as 5.1 km on Strava still counts). We deliberately
// reject runs shorter than the target — a 4.9 km run isn't a 5K PB.
const PB_TOLERANCE_PCT = 0.1

export interface BestEffort {
  time_s: number
  date: string
  activity_id: number | null
  distance_m: number
  pace_s_per_km: number
}

export interface BestEfforts {
  d_5k: BestEffort | null
  d_10k: BestEffort | null
  d_half: BestEffort | null
  d_full: BestEffort | null
}

export const PB_DISTANCE_META = PB_DISTANCES

export function bestEfforts(activities: ActivityForDerived[]): BestEfforts {
  const runs = activities.filter(
    a => a.type === 'Run' && (a.source ?? 'synced') !== 'inferred',
  )

  const out: BestEfforts = {
    d_5k: null,
    d_10k: null,
    d_half: null,
    d_full: null,
  }

  for (const d of PB_DISTANCES) {
    const maxDist = d.meters * (1 + PB_TOLERANCE_PCT)
    let best: BestEffort | null = null
    for (const r of runs) {
      if (r.distance_m < d.meters || r.distance_m > maxDist) continue
      if (!r.moving_time_s || r.moving_time_s <= 0) continue
      if (best === null || r.moving_time_s < best.time_s) {
        best = {
          time_s: r.moving_time_s,
          date: ymdInAmsterdam(new Date(r.start_at)),
          activity_id: r.id ?? null,
          distance_m: r.distance_m,
          pace_s_per_km: Math.round((r.moving_time_s / r.distance_m) * 1000),
        }
      }
    }
    out[d.key] = best
  }

  return out
}
