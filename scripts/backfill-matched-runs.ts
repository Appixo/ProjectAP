// One-off backfill: for every planned run_* training_session that has no
// matched_activity_id, check whether a Strava-synced run lives on the same
// Amsterdam calendar day. If exactly one planned-unmatched session AND
// exactly one Run activity share that day, link them and flip status to
// 'completed'. Mirrors the same-day single-candidate rule used live by
// matchPlannedRun() in lib/strava/sync.ts.
//
// Idempotent: only touches rows where matched_activity_id IS NULL. Safe to
// re-run; rows already matched (by sync or by a prior run of this script)
// are skipped.
//
// Run with: pnpm tsx scripts/backfill-matched-runs.ts

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import WebSocket from 'ws'
import { createClient } from '@supabase/supabase-js'

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

interface PlannedRunRow {
  id: string
  session_at_local: string
  modality: string
}

interface ActivityRow {
  id: number
  start_at: string
}

function amsterdamYmd(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
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

  // All planned run_* sessions with no link, ordered chronologically.
  const { data: planned, error: plannedError } = await supabase
    .from('training_sessions')
    .select('id, session_at_local, modality')
    .eq('user_id', userId)
    .eq('status', 'planned')
    .like('modality', 'run_%')
    .is('matched_activity_id', null)
    .order('session_at_local', { ascending: true })
    .returns<PlannedRunRow[]>()

  if (plannedError) throw new Error(`planned query failed: ${plannedError.message}`)
  const plannedRows = planned ?? []
  console.log(`Unmatched planned run_* sessions: ${plannedRows.length}`)
  if (plannedRows.length === 0) {
    console.log('Nothing to backfill.')
    return
  }

  // Group planned rows by Amsterdam date (slice of session_at_local).
  const plannedByDate = new Map<string, PlannedRunRow[]>()
  for (const p of plannedRows) {
    const ymd = p.session_at_local.slice(0, 10)
    const list = plannedByDate.get(ymd) ?? []
    list.push(p)
    plannedByDate.set(ymd, list)
  }

  // Fetch run activities once for the full window the planned rows span,
  // then bucket by Amsterdam date. Avoids N queries.
  const dates = Array.from(plannedByDate.keys()).sort()
  const minYmd = dates[0]
  const maxYmd = dates[dates.length - 1]
  // Pad window by a day on each side so timezone-boundary activities aren't
  // dropped from the per-day bucketing step.
  const sinceIso = new Date(minYmd + 'T00:00:00Z').toISOString()
  const untilDate = new Date(maxYmd + 'T00:00:00Z')
  untilDate.setUTCDate(untilDate.getUTCDate() + 2)
  const untilIso = untilDate.toISOString()

  const { data: activitiesRaw, error: actError } = await supabase
    .from('activities')
    .select('id, start_at')
    .eq('user_id', userId)
    .eq('type', 'Run')
    .gte('start_at', sinceIso)
    .lt('start_at', untilIso)
    .returns<ActivityRow[]>()

  if (actError) throw new Error(`activities query failed: ${actError.message}`)
  const activities = activitiesRaw ?? []
  console.log(`Run activities in window ${minYmd} → ${maxYmd}: ${activities.length}`)

  const activitiesByDate = new Map<string, ActivityRow[]>()
  for (const a of activities) {
    const ymd = amsterdamYmd(a.start_at)
    const list = activitiesByDate.get(ymd) ?? []
    list.push(a)
    activitiesByDate.set(ymd, list)
  }

  let matched = 0
  const skipped: { date: string; reason: string }[] = []

  for (const [date, plannedList] of plannedByDate) {
    const dayActivities = activitiesByDate.get(date) ?? []
    if (plannedList.length !== 1) {
      skipped.push({
        date,
        reason: `${plannedList.length} unmatched planned rows on this day — ambiguous`,
      })
      continue
    }
    if (dayActivities.length === 0) {
      skipped.push({ date, reason: 'no Run activity on this day' })
      continue
    }
    if (dayActivities.length > 1) {
      skipped.push({
        date,
        reason: `${dayActivities.length} Run activities on this day — ambiguous`,
      })
      continue
    }

    const target = plannedList[0]
    const activity = dayActivities[0]
    const { error: updateError } = await supabase
      .from('training_sessions')
      .update({
        status: 'completed',
        matched_activity_id: activity.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', target.id)
      .eq('user_id', userId)

    if (updateError) {
      skipped.push({ date, reason: `update_failed: ${updateError.message}` })
      continue
    }
    console.log(
      `  ${date}  matched planned ${target.modality} (session ${target.id.slice(0, 8)}…) → activity ${activity.id}`,
    )
    matched++
  }

  console.log(`\nMatched: ${matched}`)
  console.log(`Skipped: ${skipped.length}`)
  for (const s of skipped) {
    console.log(`  ${s.date}  ${s.reason}`)
  }
  console.log('\nDone.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
