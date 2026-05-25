// One-off: log the Rotterdam Marathon 2025-04-13 result (4:19:45) as a
// personal-best row. Idempotent: skips insert if a matching row already
// exists for the same user/distance/time/date.
//
// Run with: pnpm tsx scripts/add-rotterdam-2025-pb.ts

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

const MARATHON_M = 42195
// 4:19:45 = 4*3600 + 19*60 + 45 = 15585 s
const TIME_S = 4 * 3600 + 19 * 60 + 45
const ACHIEVED_AT = '2025-04-13'
const EVENT_NAME = 'Rotterdam Marathon'

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

  // Show any existing marathon-distance PBs so the user can see whether
  // their 4:19:45 will be the new best after merge.
  const { data: existing, error: existingError } = await supabase
    .from('personal_bests')
    .select('distance_m, time_s, achieved_at, source, event_name, activity_id')
    .eq('user_id', userId)
    .eq('distance_m', MARATHON_M)
    .order('time_s', { ascending: true })

  if (existingError) throw new Error(`query failed: ${existingError.message}`)
  console.log(`\nExisting marathon-distance personal_bests rows: ${existing?.length ?? 0}`)
  for (const r of existing ?? []) {
    const h = Math.floor(r.time_s / 3600)
    const m = Math.floor((r.time_s % 3600) / 60)
    const s = r.time_s % 60
    const pretty = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    console.log(
      `  ${r.achieved_at}  ${pretty}  ${r.event_name ?? '—'}  source=${r.source}  activity=${r.activity_id ?? '—'}`,
    )
  }

  const dup = (existing ?? []).find(
    r => r.time_s === TIME_S && r.achieved_at === ACHIEVED_AT,
  )
  if (dup) {
    console.log('\nIdentical row already present — nothing to insert.')
    return
  }

  console.log(
    `\nInserting Rotterdam Marathon 2025: ${ACHIEVED_AT}, ${MARATHON_M} m, ${TIME_S} s (4:19:45)...`,
  )
  const { error: insertError } = await supabase.from('personal_bests').insert({
    user_id: userId,
    distance_m: MARATHON_M,
    time_s: TIME_S,
    achieved_at: ACHIEVED_AT,
    event_name: EVENT_NAME,
    source: 'logged' as const,
  })
  if (insertError) throw new Error(`insert failed: ${insertError.message}`)
  console.log('Inserted.')
  console.log('\nDone.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
