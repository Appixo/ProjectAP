// Pure transformer: raw rows from Supabase → WeekStrip props (deduped,
// matched, mapped). Used by both the dashboard SSR path and the
// /api/dashboard/strip endpoint so client-side nav and first paint produce
// identical strip data.

import type {
  WeekStripRun,
  WeekStripSession,
  SessionDescription,
} from '@/components/dashboard/WeekStrip'
import { asRunType, type RunType } from '@/lib/run/classify'

export interface RawStripRun {
  id: number
  start_at: string
  distance_m: number
  moving_time_s: number
  average_speed_mps: number | null
  run_type?: string | null
}

export interface RawStripSession {
  id: string
  session_at: string
  session_at_local: string
  modality: string
  duration_min: number | null
  rpe: number | null
  status: 'planned' | 'completed' | 'skipped' | null
  description: SessionDescription | null
  format: string | null
  notes: string | null
  matched_activity_id: number | null
}

export interface StripData {
  runs: WeekStripRun[]
  sessions: WeekStripSession[]
}

/**
 * Build WeekStrip props from raw query rows.
 *
 * `runTypeByActivityId` is optional — when omitted (e.g. the API endpoint
 * doesn't want to pay for a full classifier run on every nav), each run falls
 * back to its persisted run_type column (set when a plan matched), then to
 * 'easy'. The strip uses this only for the small coloured dot, so the cosmetic
 * cost of a wrong default is low.
 */
export function buildStripData(
  rawRuns: RawStripRun[],
  rawSessions: RawStripSession[],
  runTypeByActivityId?: Map<number, RunType>,
): StripData {
  const matchedActivityIds = new Set(
    rawSessions
      .filter(s => s.matched_activity_id != null)
      .map(s => s.matched_activity_id as number),
  )
  const runById = new Map(rawRuns.map(r => [r.id, r]))

  const runTypeFor = (r: RawStripRun): RunType =>
    runTypeByActivityId?.get(r.id) ?? asRunType(r.run_type) ?? 'easy'

  const runs: WeekStripRun[] = rawRuns
    .filter(r => !matchedActivityIds.has(r.id))
    .map(r => ({
      id: r.id,
      start_at: r.start_at,
      distance_m: r.distance_m,
      moving_time_s: r.moving_time_s,
      runType: runTypeFor(r),
    }))

  const sessions: WeekStripSession[] = rawSessions
    .filter(s => (s.status ?? 'completed') !== 'skipped')
    .map(s => {
      const matched =
        s.matched_activity_id != null ? runById.get(s.matched_activity_id) : undefined
      return {
        id: s.id,
        session_at_local: s.session_at_local,
        modality: s.modality,
        duration_min: s.duration_min,
        rpe: s.rpe,
        status: s.status,
        description: s.description,
        format: s.format,
        notes: s.notes,
        matched_run: matched
          ? {
              id: matched.id,
              start_at: matched.start_at,
              distance_m: matched.distance_m,
              moving_time_s: matched.moving_time_s,
              runType: runTypeFor(matched),
            }
          : null,
      }
    })

  return { runs, sessions }
}
