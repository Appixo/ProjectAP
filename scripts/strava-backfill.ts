import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import WebSocket from 'ws'
import { createClient } from '@supabase/supabase-js'
import { refreshAccessToken } from '../lib/strava/client'
import {
  transformActivity,
  type StravaSummaryActivity,
} from '../lib/strava/transform'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const MONTHS_BACK = Number(process.env.BACKFILL_MONTHS ?? 12)
const PAGE_SIZE = 200

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}

interface StravaAccountRow {
  user_id: string
  athlete_id: number
  access_token: string
  refresh_token: string
  token_expires_at: string
}

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: {
      transport: WebSocket as unknown as typeof globalThis.WebSocket,
    },
  })

  const { data: accounts, error } = await supabase
    .from('strava_account')
    .select('user_id, athlete_id, access_token, refresh_token, token_expires_at')

  if (error) throw error
  if (!accounts || accounts.length === 0) {
    console.error('No strava_account rows. Connect Strava first.')
    process.exit(1)
  }

  for (const account of accounts as StravaAccountRow[]) {
    console.log(`Backfilling for athlete ${account.athlete_id}...`)

    let accessToken = account.access_token
    const expiresAtMs = new Date(account.token_expires_at).getTime()
    if (expiresAtMs < Date.now() + 60_000) {
      console.log('  refreshing access token...')
      const refreshed = await refreshAccessToken(account.refresh_token)
      accessToken = refreshed.access_token
      const { error: updateError } = await supabase
        .from('strava_account')
        .update({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', account.user_id)
      if (updateError) throw updateError
    }

    const after = Math.floor(
      (Date.now() - MONTHS_BACK * 30 * 86400 * 1000) / 1000,
    )
    let page = 1
    let totalFetched = 0
    let totalRuns = 0

    while (true) {
      const url = new URL('https://www.strava.com/api/v3/athlete/activities')
      url.searchParams.set('after', String(after))
      url.searchParams.set('per_page', String(PAGE_SIZE))
      url.searchParams.set('page', String(page))

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      if (!res.ok) {
        throw new Error(`Strava API ${res.status}: ${await res.text()}`)
      }
      const batch = (await res.json()) as StravaSummaryActivity[]
      totalFetched += batch.length

      const runs = batch.filter(a => a.type === 'Run')
      totalRuns += runs.length

      if (runs.length > 0) {
        const rows = runs.map(a => transformActivity(a, account.user_id))
        const { error: upsertError } = await supabase
          .from('activities')
          .upsert(rows, { onConflict: 'id' })
        if (upsertError) throw upsertError
      }

      console.log(
        `  page ${page}: ${batch.length} activities, ${runs.length} runs`,
      )

      if (batch.length < PAGE_SIZE) break
      page++
    }

    console.log(
      `Done for athlete ${account.athlete_id}. ` +
        `Fetched ${totalFetched} activities in last ${MONTHS_BACK} months, ` +
        `upserted ${totalRuns} runs.`,
    )
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
