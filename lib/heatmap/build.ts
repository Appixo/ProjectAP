// Aggregator for the year-of-training heatmap. Pure function, used by
// /history and the dashboard mirror.
//
// Counting rule (matches the heatmap legend):
//   - Strava activities (any type) contribute moving_time minutes.
//   - Non-run training_sessions with a duration_min add their minutes.
//   - Run-modality sessions are excluded (the run is already in activities).

import { ymdInAmsterdam } from '@/lib/time/week'
import type { HeatmapDay } from '@/components/dashboard/YearHeatmap'

const MODALITY_HUMAN: Record<string, string> = {
  strength_upper: 'upper',
  strength_lower: 'lower',
  strength_full: 'full',
  football: 'football',
  cycling: 'cycling',
  swimming: 'swimming',
  mobility: 'mobility',
  run_easy: 'easy',
  run_tempo: 'tempo',
  run_long: 'long',
  run_threshold: 'threshold',
  run_vo2: 'vo2',
  run_race: 'race',
  run_recovery: 'recovery',
  other: 'other',
}

export interface HeatmapActivity {
  start_at: string
  distance_m: number
  moving_time_s: number
  type: string
}

export interface HeatmapSession {
  session_at_local: string
  modality: string
  duration_min: number | null
}

export function buildHeatmapDays(
  activities: HeatmapActivity[],
  sessions: HeatmapSession[],
): HeatmapDay[] {
  const byDay = new Map<string, { totalMin: number; parts: string[] }>()

  const ensure = (ymd: string) => {
    let cur = byDay.get(ymd)
    if (!cur) {
      cur = { totalMin: 0, parts: [] }
      byDay.set(ymd, cur)
    }
    return cur
  }

  for (const a of activities) {
    const ymd = ymdInAmsterdam(new Date(a.start_at))
    const min = Math.round(a.moving_time_s / 60)
    const cell = ensure(ymd)
    cell.totalMin += min
    if (a.type === 'Run') {
      cell.parts.push(`${(a.distance_m / 1000).toFixed(1)} km run`)
    } else {
      cell.parts.push(`${min} min ${a.type.toLowerCase()}`)
    }
  }

  for (const s of sessions) {
    if (!s.duration_min) continue
    if (s.modality.startsWith('run_')) continue
    const ymd = s.session_at_local.slice(0, 10)
    const cell = ensure(ymd)
    cell.totalMin += s.duration_min
    cell.parts.push(`${s.duration_min} min ${MODALITY_HUMAN[s.modality] ?? s.modality}`)
  }

  // Rolling 365-day window ending today. Empty days still emitted so the
  // grid has every cell.
  const today = ymdInAmsterdam(new Date())
  const out: HeatmapDay[] = []
  for (let i = 364; i >= 0; i--) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - i)
    const ymd = ymdInAmsterdam(d)
    const cell = byDay.get(ymd)
    out.push({
      ymd,
      totalMin: cell?.totalMin ?? 0,
      breakdown: cell?.parts.join(' + ') ?? '',
    })
    if (ymd === today) break
  }
  return out
}
