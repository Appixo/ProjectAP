// One-off: backfill morning wellness numbers from Samsung Health screens
// for 2026-05-25 and 2026-05-26. Idempotent — upserts by (user_id, log_date)
// and only the fields listed in each entry's `patch` are written, so other
// columns (sleep_score, the subjective `energy` 1-5, habits, RHR/HRV, notes,
// ...) are never touched.
//
// 2026-05-25 sleep_hours=9.3 covers total time asleep (9h 18m = 558 min)
// INCLUDING the morning nap. 2026-05-26 sleep_hours=3.85 is main sleep only
// (3h 51m = 231 min, no nap shown). The column unit is hours (numeric), so
// the minute values from the watch are converted: 558/60=9.3, 231/60=3.85.
//
// Run with: pnpm tsx scripts/backfill-energy-score-2026-05.ts

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

const ENTRIES: Array<{ log_date: string; patch: Record<string, number> }> = [
  { log_date: '2026-05-25', patch: { energy_score: 82, sleep_hours: 9.3 } },
  { log_date: '2026-05-26', patch: { energy_score: 78, sleep_hours: 3.85 } },
]

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

  for (const { log_date, patch } of ENTRIES) {
    const { error } = await supabase
      .from('daily_log')
      .upsert(
        { user_id: userId, log_date, ...patch },
        { onConflict: 'user_id,log_date' },
      )
    if (error) {
      throw new Error(`upsert ${log_date} failed: ${error.message}`)
    }
    const pretty = Object.entries(patch)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')
    console.log(`Upserted ${log_date} -> ${pretty}`)
  }

  // Verify: show the last 7 daily_log rows so the user can eyeball the
  // backfill landed and nothing else changed.
  const { data: rows, error: selectError } = await supabase
    .from('daily_log')
    .select('log_date, energy_score, sleep_hours, sleep_score, energy, morning_rhr_bpm, hrv_ms')
    .eq('user_id', userId)
    .order('log_date', { ascending: false })
    .limit(7)

  if (selectError) throw new Error(`select failed: ${selectError.message}`)
  console.log('\nLast daily_log rows:')
  console.log('  date        energy_score  sleep_hrs  sleep_score  energy(1-5)  RHR   HRV')
  for (const r of rows ?? []) {
    const cells = [
      r.log_date,
      String(r.energy_score ?? '—').padStart(12),
      String(r.sleep_hours ?? '—').padStart(9),
      String(r.sleep_score ?? '—').padStart(11),
      String(r.energy ?? '—').padStart(11),
      String(r.morning_rhr_bpm ?? '—').padStart(4),
      String(r.hrv_ms ?? '—').padStart(4),
    ]
    console.log(`  ${cells.join('  ')}`)
  }
  console.log('\nDone.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
