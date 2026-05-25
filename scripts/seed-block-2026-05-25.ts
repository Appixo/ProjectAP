// One-off seed: 4-week PR-recovery block (Mon 2026-05-25 → Sun 2026-06-21).
//
// Replaces the inferred Tue/Wed/Thu/Fri/Sun template for these weeks with a
// 7-day-aware plan that has flex Mon/Thu/Sat, an easy Tue in Wk1 (override
// of the inferred threshold — too soon after the 47:25 10K PR), and a
// progressive threshold intro in Wk2/Wk3 (3×6 → 3×8 @ 5:00/km).
//
// Dedup: deletes pristine inferred-planned rows in the window first
// (source='inferred' AND status='planned' AND matched_activity_id IS NULL),
// so the user's completed/skipped/edited/matched rows survive. After the
// seed, lib/plan/extend.ts skips these weeks because rows exist for them.
//
// Run once with: pnpm tsx scripts/seed-block-2026-05-25.ts

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import WebSocket from 'ws'
import { createClient } from '@supabase/supabase-js'
import { addDays, amsterdamWallClockToUtcIso } from '../lib/time/week'

const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL
const OWNER_USER_ID_ENV = process.env.OWNER_USER_ID
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!ALLOWED_EMAIL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing ALLOWED_EMAIL, NEXT_PUBLIC_SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}

const BLOCK_START = '2026-05-25' // Mon W1
const BLOCK_END_EXCLUSIVE = '2026-06-22' // Mon after W4

type Modality =
  | 'run_easy'
  | 'run_threshold'
  | 'run_long'
  | 'run_recovery'
  | 'strength_upper'
  | 'football'

interface SessionDescription {
  target_distance_km?: number
  target_duration_min?: number
  target_hr_min?: number
  target_hr_max?: number
  target_pace_s_per_km_min?: number
  target_pace_s_per_km_max?: number
  reason: string
  flexible?: boolean
  alternative?: 'rest' | 'easy'
}

interface DaySpec {
  weekIdx: 0 | 1 | 2 | 3
  dow: 0 | 1 | 2 | 3 | 4 | 5 | 6 // 0=Mon..6=Sun
  hourLocal: number
  minuteLocal: number
  modality: Modality
  format?: string
  description: SessionDescription
}

// Default times mirror lib/plan/progression.ts WEEK_TEMPLATE.
const EASY_TIME = { h: 12, m: 30 }
const THRESHOLD_TIME = { h: 12, m: 30 }
const STRENGTH_TIME = { h: 19, m: 0 }
const FOOTBALL_TIME = { h: 19, m: 30 }
const LONG_TIME = { h: 8, m: 0 }
const SHAKEOUT_TIME = { h: 10, m: 0 }

const HR_EASY_MAX = 145
const HR_RECOVERY_MAX = 140
const HR_LONG_MAX = 150
const HR_THRESHOLD_MIN = 158
const HR_THRESHOLD_MAX = 170

const PACE_THRESHOLD_MIN_SPK = 295 // 4:55/km
const PACE_THRESHOLD_MAX_SPK = 305 // 5:05/km
const PACE_LONG_MIN_SPK = 5 * 60 + 30
const PACE_LONG_MAX_SPK = 5 * 60 + 50

function week1(): DaySpec[] {
  return [
    {
      weekIdx: 0, dow: 0, hourLocal: SHAKEOUT_TIME.h, minuteLocal: SHAKEOUT_TIME.m,
      modality: 'run_recovery',
      description: {
        target_duration_min: 25,
        target_hr_max: HR_RECOVERY_MAX,
        reason: 'flex — rest OR 20–30 min very easy shakeout after the 10K PR',
        flexible: true,
        alternative: 'rest',
      },
    },
    {
      weekIdx: 0, dow: 1, hourLocal: EASY_TIME.h, minuteLocal: EASY_TIME.m,
      modality: 'run_easy',
      description: {
        target_distance_km: 7,
        target_hr_max: HR_EASY_MAX,
        reason: 'override of inferred threshold — too soon after PR; HR-led conversational',
      },
    },
    {
      weekIdx: 0, dow: 2, hourLocal: STRENGTH_TIME.h, minuteLocal: STRENGTH_TIME.m,
      modality: 'strength_upper',
      description: {
        target_duration_min: 40,
        reason: 'pinned Wed — office day; injury-resilience volume',
      },
    },
    {
      weekIdx: 0, dow: 3, hourLocal: EASY_TIME.h, minuteLocal: EASY_TIME.m,
      modality: 'run_easy',
      description: {
        target_distance_km: 6,
        target_hr_max: HR_EASY_MAX,
        reason: 'flex — skip if legs heavy pre-football; never stack hard adjacent to football',
        flexible: true,
        alternative: 'rest',
      },
    },
    {
      weekIdx: 0, dow: 4, hourLocal: FOOTBALL_TIME.h, minuteLocal: FOOTBALL_TIME.m,
      modality: 'football',
      description: {
        target_duration_min: 50,
        reason: 'week intensity — Fri football 6v6 2x25min, standing commitment',
      },
    },
    {
      weekIdx: 0, dow: 5, hourLocal: SHAKEOUT_TIME.h, minuteLocal: SHAKEOUT_TIME.m,
      modality: 'run_recovery',
      description: {
        target_distance_km: 5,
        target_hr_max: HR_RECOVERY_MAX,
        reason: 'flex — rest OR short easy shake post-football',
        flexible: true,
        alternative: 'rest',
      },
    },
    {
      weekIdx: 0, dow: 6, hourLocal: LONG_TIME.h, minuteLocal: LONG_TIME.m,
      modality: 'run_long',
      description: {
        target_distance_km: 16,
        target_hr_max: HR_LONG_MAX,
        target_pace_s_per_km_min: PACE_LONG_MIN_SPK,
        target_pace_s_per_km_max: PACE_LONG_MAX_SPK,
        reason: 'HR ceiling wins; pace descriptive — drift in heat is fine',
      },
    },
  ]
}

function thresholdTuesday(weekIdx: 1 | 2, reps: number, repMin: number): DaySpec {
  return {
    weekIdx, dow: 1, hourLocal: THRESHOLD_TIME.h, minuteLocal: THRESHOLD_TIME.m,
    modality: 'run_threshold',
    format: `${reps}×${repMin} min @ ~5:00/km, 2 min jog recovery`,
    description: {
      target_distance_km: weekIdx === 1 ? 7 : 9,
      target_hr_min: HR_THRESHOLD_MIN,
      target_hr_max: HR_THRESHOLD_MAX,
      target_pace_s_per_km_min: PACE_THRESHOLD_MIN_SPK,
      target_pace_s_per_km_max: PACE_THRESHOLD_MAX_SPK,
      reason:
        weekIdx === 1
          ? 'first quality after zero-stimulus block; progressive ramp Wk2→Wk3'
          : 'second quality session — held format from Wk2, more time at threshold',
    },
  }
}

function longSunday(weekIdx: 0 | 1 | 2 | 3, km: number, reason: string): DaySpec {
  return {
    weekIdx, dow: 6, hourLocal: LONG_TIME.h, minuteLocal: LONG_TIME.m,
    modality: 'run_long',
    description: {
      target_distance_km: km,
      target_hr_max: HR_LONG_MAX,
      target_pace_s_per_km_min: PACE_LONG_MIN_SPK,
      target_pace_s_per_km_max: PACE_LONG_MAX_SPK,
      reason,
    },
  }
}

function strengthWed(weekIdx: 0 | 1 | 2 | 3): DaySpec {
  return {
    weekIdx, dow: 2, hourLocal: STRENGTH_TIME.h, minuteLocal: STRENGTH_TIME.m,
    modality: 'strength_upper',
    description: {
      target_duration_min: 40,
      reason: 'pinned Wed — office day; injury-resilience volume',
    },
  }
}

function football(weekIdx: 0 | 1 | 2 | 3): DaySpec {
  return {
    weekIdx, dow: 4, hourLocal: FOOTBALL_TIME.h, minuteLocal: FOOTBALL_TIME.m,
    modality: 'football',
    description: {
      target_duration_min: 50,
      reason: 'week intensity — Fri football 6v6 2x25min, standing commitment',
    },
  }
}

function flexShakeMon(weekIdx: 0 | 1 | 2 | 3, reasonExtra = ''): DaySpec {
  return {
    weekIdx, dow: 0, hourLocal: SHAKEOUT_TIME.h, minuteLocal: SHAKEOUT_TIME.m,
    modality: 'run_recovery',
    description: {
      target_duration_min: 25,
      target_hr_max: HR_RECOVERY_MAX,
      reason: `flex — rest OR 20–30 min very easy shakeout${reasonExtra ? `; ${reasonExtra}` : ''}`,
      flexible: true,
      alternative: 'rest',
    },
  }
}

function flexEasyThu(weekIdx: 0 | 1 | 2 | 3, reasonExtra = ''): DaySpec {
  return {
    weekIdx, dow: 3, hourLocal: EASY_TIME.h, minuteLocal: EASY_TIME.m,
    modality: 'run_easy',
    description: {
      target_distance_km: 6,
      target_hr_max: HR_EASY_MAX,
      reason: `flex — skip if legs heavy pre-football; never stack hard adjacent to football${reasonExtra ? `; ${reasonExtra}` : ''}`,
      flexible: true,
      alternative: 'rest',
    },
  }
}

function flexShakeSat(weekIdx: 0 | 1 | 2 | 3, reasonExtra = ''): DaySpec {
  return {
    weekIdx, dow: 5, hourLocal: SHAKEOUT_TIME.h, minuteLocal: SHAKEOUT_TIME.m,
    modality: 'run_recovery',
    description: {
      target_distance_km: 5,
      target_hr_max: HR_RECOVERY_MAX,
      reason: `flex — rest OR short easy shake post-football${reasonExtra ? `; ${reasonExtra}` : ''}`,
      flexible: true,
      alternative: 'rest',
    },
  }
}

function easyTueWk4(): DaySpec {
  return {
    weekIdx: 3, dow: 1, hourLocal: EASY_TIME.h, minuteLocal: EASY_TIME.m,
    modality: 'run_easy',
    description: {
      target_distance_km: 6,
      target_hr_max: HR_EASY_MAX,
      reason: 'cutback Tue — no quality; HR-led easy',
    },
  }
}

function week2(): DaySpec[] {
  return [
    flexShakeMon(1),
    thresholdTuesday(1, 3, 6),
    strengthWed(1),
    flexEasyThu(1),
    football(1),
    flexShakeSat(1),
    longSunday(1, 18, 'step +2 from Wk1 — easy, HR-capped'),
  ]
}

function week3(): DaySpec[] {
  return [
    flexShakeMon(2),
    thresholdTuesday(2, 3, 8),
    strengthWed(2),
    flexEasyThu(2),
    football(2),
    flexShakeSat(2),
    longSunday(
      2,
      20,
      'mid-June ≥20 km target hit — first 20 km of the marathon block',
    ),
  ]
}

function week4(): DaySpec[] {
  return [
    flexShakeMon(3, 'cutback week — favor rest'),
    easyTueWk4(),
    strengthWed(3),
    flexEasyThu(3, 'cutback week — favor rest'),
    football(3),
    flexShakeSat(3, 'cutback week — favor rest'),
    longSunday(
      3,
      14,
      'cutback long run — benchmark: record HR drift vs Wk1 Sun 16 km to gauge endurance gain',
    ),
  ]
}

function buildAllSessions(): DaySpec[] {
  return [...week1(), ...week2(), ...week3(), ...week4()]
}

interface RowInWindow {
  id: string
  session_at_local: string
  modality: string
  status: string | null
  source: string | null
  matched_activity_id: number | null
}

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: {
      transport: WebSocket as unknown as typeof globalThis.WebSocket,
    },
  })

  let userId: string
  if (OWNER_USER_ID_ENV) {
    userId = OWNER_USER_ID_ENV
  } else {
    const { data, error } = await supabase.auth.admin.listUsers()
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const owner = data.users.find(
      u => u.email?.toLowerCase() === ALLOWED_EMAIL!.toLowerCase(),
    )
    if (!owner) throw new Error(`no user found with email ${ALLOWED_EMAIL}`)
    userId = owner.id
  }
  console.log(`Owner user_id: ${userId}`)

  const windowStartIso = new Date(BLOCK_START + 'T00:00:00Z').toISOString()
  const windowEndIso = new Date(BLOCK_END_EXCLUSIVE + 'T00:00:00Z').toISOString()

  // Inventory all rows in the window so we have a snapshot before delete.
  const { data: allInWindow, error: inventoryError } = await supabase
    .from('training_sessions')
    .select('id, session_at_local, modality, status, source, matched_activity_id')
    .eq('user_id', userId)
    .gte('session_at', windowStartIso)
    .lt('session_at', windowEndIso)
    .order('session_at_local', { ascending: true })

  if (inventoryError) throw new Error(`inventory failed: ${inventoryError.message}`)
  const rowsInWindow = (allInWindow ?? []) as RowInWindow[]

  console.log(`\nWindow ${BLOCK_START} → ${BLOCK_END_EXCLUSIVE} (exclusive)`)
  console.log(`Existing rows in window: ${rowsInWindow.length}`)
  for (const r of rowsInWindow) {
    console.log(
      `  ${r.session_at_local}  ${r.modality.padEnd(16)}  status=${r.status ?? '—'}  source=${r.source ?? '—'}  matched=${r.matched_activity_id ?? '—'}`,
    )
  }

  const pristineIds = rowsInWindow
    .filter(
      r =>
        r.source === 'inferred' &&
        r.status === 'planned' &&
        r.matched_activity_id == null,
    )
    .map(r => r.id)

  console.log(`\nWill delete ${pristineIds.length} pristine inferred-planned row(s).`)
  if (pristineIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('training_sessions')
      .delete()
      .in('id', pristineIds)
    if (deleteError) throw new Error(`delete failed: ${deleteError.message}`)
    console.log(`Deleted ${pristineIds.length} row(s).`)
  }

  const sessions = buildAllSessions()
  console.log(`\nInserting ${sessions.length} manual planned rows...`)

  const rows = sessions.map(s => {
    const dateYmd = addDays(BLOCK_START, s.weekIdx * 7 + s.dow)
    const hh = String(s.hourLocal).padStart(2, '0')
    const mm = String(s.minuteLocal).padStart(2, '0')
    const sessionAtLocal = `${dateYmd}T${hh}:${mm}`
    return {
      user_id: userId,
      session_at: amsterdamWallClockToUtcIso(sessionAtLocal),
      session_at_local: sessionAtLocal + ':00',
      timezone: 'Europe/Amsterdam',
      modality: s.modality,
      duration_min: null,
      rpe: null,
      format: s.format ?? null,
      notes: null,
      status: 'planned' as const,
      description: s.description,
      source: 'logged' as const,
    }
  })

  const { error: insertError } = await supabase.from('training_sessions').insert(rows)
  if (insertError) throw new Error(`insert failed: ${insertError.message}`)
  console.log(`Inserted ${rows.length} row(s).`)

  // Verify: re-count by (source, status) so the user can sanity-check.
  const { data: postInventory } = await supabase
    .from('training_sessions')
    .select('source, status')
    .eq('user_id', userId)
    .gte('session_at', windowStartIso)
    .lt('session_at', windowEndIso)

  const tally = new Map<string, number>()
  for (const r of (postInventory ?? []) as Array<{ source: string | null; status: string | null }>) {
    const key = `${r.source ?? '—'}/${r.status ?? '—'}`
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  console.log('\nPost-seed tally (source/status):')
  for (const [k, v] of tally) console.log(`  ${k}: ${v}`)

  console.log('\nDone.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
