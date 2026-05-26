// One-off: backfill Samsung Energy Score for 2026-05-25 and 2026-05-26.
// Idempotent — upserts by (user_id, log_date), updating ONLY energy_score
// when the row already exists, so other fields (sleep, RHR, HRV, notes,
// the subjective `energy` 1-5, habits, ...) are never touched.
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

const ENTRIES: Array<{ log_date: string; energy_score: number }> = [
  { log_date: '2026-05-25', energy_score: 82 },
  { log_date: '2026-05-26', energy_score: 78 },
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

  for (const { log_date, energy_score } of ENTRIES) {
    const { error } = await supabase
      .from('daily_log')
      .upsert(
        { user_id: userId, log_date, energy_score },
        { onConflict: 'user_id,log_date' },
      )
    if (error) {
      throw new Error(`upsert ${log_date} failed: ${error.message}`)
    }
    console.log(`Upserted ${log_date} -> energy_score=${energy_score}`)
  }

  // Verify: show the last 7 daily_log rows so the user can eyeball the
  // backfill landed and nothing else changed.
  const { data: rows, error: selectError } = await supabase
    .from('daily_log')
    .select('log_date, energy_score, sleep_score, energy, morning_rhr_bpm, hrv_ms')
    .eq('user_id', userId)
    .order('log_date', { ascending: false })
    .limit(7)

  if (selectError) throw new Error(`select failed: ${selectError.message}`)
  console.log('\nLast daily_log rows:')
  console.log('  date        energy_score  sleep_score  energy(1-5)  RHR   HRV')
  for (const r of rows ?? []) {
    const cells = [
      r.log_date,
      String(r.energy_score ?? '—').padStart(12),
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
