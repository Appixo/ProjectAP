import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getOwnerUserId } from '@/lib/auth/owner'
import { generatePlan, type SessionInput } from './generate'
import { PROGRESSION } from './progression'
import { deriveMetrics, type ActivityForDerived } from '@/lib/run/derived'
import { amsterdamWallClockToUtcIso, todayMondayInAmsterdam, addWeeks } from '@/lib/time/week'
// addWeeks is used inside the loop below for per-week range bounds; the
// horizon filter takes the first N PROGRESSION rows whose Monday is today
// or later, regardless of calendar gap, so we always materialise exactly
// HORIZON_WEEKS plan weeks even when "today" sits before the plan starts.
import type { ManualPersonalBest } from '@/lib/run/best_efforts'

// Materialise the next HORIZON_WEEKS of the marathon plan as training_sessions
// rows if they don't already exist. Idempotent: weeks with any existing rows
// are skipped. Never overwrites.

const HORIZON_WEEKS = 4

export interface ExtendPlanResult {
  ok: true
  materialised_weeks: { wk: number; mondayYmd: string; sessions: number }[]
  skipped_weeks: { wk: number; mondayYmd: string; reason: string }[]
}

export async function extendPlanForOwner(): Promise<ExtendPlanResult> {
  const userId = await getOwnerUserId()
  const admin = createSupabaseAdminClient()

  const todayMonday = todayMondayInAmsterdam()

  const targetWeeks = PROGRESSION
    .filter(w => w.mondayYmd >= todayMonday)
    .slice(0, HORIZON_WEEKS)

  const materialised: ExtendPlanResult['materialised_weeks'] = []
  const skipped: ExtendPlanResult['skipped_weeks'] = []

  if (targetWeeks.length === 0) {
    return { ok: true, materialised_weeks: [], skipped_weeks: [] }
  }

  const [{ data: activitiesRaw }, { data: manualPbsRaw }] = await Promise.all([
    admin
      .from('activities')
      .select(
        'id, start_at, distance_m, moving_time_s, type, has_heartrate, average_heartrate, max_heartrate, average_speed_mps, source',
      )
      .eq('user_id', userId)
      .order('start_at', { ascending: false })
      .returns<ActivityForDerived[]>(),
    admin
      .from('personal_bests')
      .select('distance_m, time_s, achieved_at, activity_id, source, event_name')
      .eq('user_id', userId)
      .returns<ManualPersonalBest[]>(),
  ])

  const derived = deriveMetrics(activitiesRaw ?? [], new Date(), null, manualPbsRaw ?? [])

  for (const w of targetWeeks) {
    const weekEndMonday = addWeeks(w.mondayYmd, 1)
    const weekStartIso = new Date(w.mondayYmd + 'T00:00:00Z').toISOString()
    const weekEndIso = new Date(weekEndMonday + 'T00:00:00Z').toISOString()

    const { count, error: countError } = await admin
      .from('training_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('session_at', weekStartIso)
      .lt('session_at', weekEndIso)

    if (countError) {
      skipped.push({ wk: w.wk, mondayYmd: w.mondayYmd, reason: `count_failed:${countError.message}` })
      continue
    }
    if ((count ?? 0) > 0) {
      skipped.push({ wk: w.wk, mondayYmd: w.mondayYmd, reason: 'rows_exist' })
      continue
    }

    const sessions: SessionInput[] = generatePlan({ weeks: [w], derived })
    const rows = sessions.map(s => ({
      user_id: userId,
      session_at: amsterdamWallClockToUtcIso(s.session_at_local),
      session_at_local: s.session_at_local.length === 16 ? s.session_at_local + ':00' : s.session_at_local,
      timezone: 'Europe/Amsterdam',
      modality: s.modality,
      duration_min: s.duration_min ?? null,
      rpe: null,
      format: null,
      notes: null,
      status: 'planned' as const,
      description: s.description ?? null,
      source: 'inferred' as const,
    }))

    const { error: insertError } = await admin.from('training_sessions').insert(rows)
    if (insertError) {
      skipped.push({ wk: w.wk, mondayYmd: w.mondayYmd, reason: `insert_failed:${insertError.message}` })
      continue
    }
    materialised.push({ wk: w.wk, mondayYmd: w.mondayYmd, sessions: rows.length })
  }

  return { ok: true, materialised_weeks: materialised, skipped_weeks: skipped }
}
