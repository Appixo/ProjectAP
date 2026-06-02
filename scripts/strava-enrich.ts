// One-off / periodic enrichment: backfill laps + interval-structure + the
// HR-time-above-tempo fraction onto run activities that were ingested via the
// summary-list path (scripts/strava-backfill.ts), which carries neither lap
// detail nor HR streams.
//
// For each candidate run it makes up to two Strava calls — the activity detail
// (laps / splits_standard) and the HR streams — so it is throttled and capped
// to stay well under Strava's 100-requests / 15-minutes limit. Re-runnable:
// only touches rows still missing the enriched fields. run_type is never
// overwritten (that's the plan's job; see scripts/backfill-matched-runs.ts).
//
// Run with:  tsx scripts/strava-enrich.ts
// Env:       ENRICH_LIMIT (default 40), ENRICH_DELAY_MS (default 800)

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import WebSocket from 'ws'
import { createClient } from '@supabase/supabase-js'
import { ensureFreshToken, fetchActivityById, type StravaAccountRow } from '../lib/strava/sync'
import { fetchActivityStreams, hrAboveTempoPct } from '../lib/strava/streams'
import { parseLaps, detectIntervalStructure } from '../lib/run/laps'

const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL
const OWNER_USER_ID_ENV = process.env.OWNER_USER_ID
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LIMIT = Number(process.env.ENRICH_LIMIT ?? 40)
const DELAY_MS = Number(process.env.ENRICH_DELAY_MS ?? 800)

if (!ALLOWED_EMAIL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing ALLOWED_EMAIL, NEXT_PUBLIC_SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
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

  const { data: account, error: accErr } = await supabase
    .from('strava_account')
    .select('user_id, athlete_id, access_token, refresh_token, token_expires_at')
    .eq('user_id', userId)
    .maybeSingle<StravaAccountRow>()
  if (accErr) throw new Error(`strava_account query failed: ${accErr.message}`)
  if (!account) {
    console.error('No strava_account row for owner. Connect Strava first.')
    process.exit(1)
  }

  // Candidates: runs that have never been enriched (laps + hr both null).
  // Most-recent first so a capped run enriches the freshest data.
  const { data: rows, error: rowsErr } = await supabase
    .from('activities')
    .select('id, start_at, has_heartrate')
    .eq('user_id', userId)
    .eq('type', 'Run')
    .is('laps', null)
    .is('hr_above_tempo_pct', null)
    .order('start_at', { ascending: false })
    .limit(LIMIT)
    .returns<{ id: number; start_at: string; has_heartrate: boolean }[]>()
  if (rowsErr) throw new Error(`activities query failed: ${rowsErr.message}`)

  const candidates = rows ?? []
  console.log(`Enriching up to ${candidates.length} run(s) (limit ${LIMIT}).`)
  if (candidates.length === 0) {
    console.log('Nothing to enrich.')
    return
  }

  const accessToken = await ensureFreshToken(supabase, account)

  let enriched = 0
  for (const r of candidates) {
    try {
      const detail = await fetchActivityById(accessToken, r.id)
      if (!detail) {
        console.log(`  ${r.id}  detail 404 — skipped`)
        continue
      }
      const laps = parseLaps(detail)
      const interval_structure = laps ? detectIntervalStructure(laps) : null

      let hr_above_tempo_pct: number | null = null
      if (r.has_heartrate) {
        await sleep(DELAY_MS)
        const streams = await fetchActivityStreams(accessToken, r.id)
        hr_above_tempo_pct = hrAboveTempoPct(streams)
      }

      const { error: updErr } = await supabase
        .from('activities')
        .update({ laps, interval_structure, hr_above_tempo_pct })
        .eq('id', r.id)
        .eq('user_id', userId)
      if (updErr) {
        console.log(`  ${r.id}  update_failed: ${updErr.message}`)
        continue
      }
      console.log(
        `  ${r.id}  laps=${laps?.length ?? 0} interval=${interval_structure ?? '—'} hr_above_tempo=${hr_above_tempo_pct ?? '—'}%`,
      )
      enriched++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  ${r.id}  error: ${msg}`)
    }
    await sleep(DELAY_MS)
  }

  console.log(`\nEnriched: ${enriched} / ${candidates.length}`)
  console.log('Done.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
