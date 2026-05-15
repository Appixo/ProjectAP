import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshAccessToken } from './client'
import {
  transformActivity,
  type StravaSummaryActivity,
} from './transform'

export interface StravaAccountRow {
  user_id: string
  athlete_id: number
  access_token: string
  refresh_token: string
  token_expires_at: string
}

export async function ensureFreshToken(
  supabase: SupabaseClient,
  account: StravaAccountRow,
): Promise<string> {
  const expiresAtMs = new Date(account.token_expires_at).getTime()
  if (expiresAtMs > Date.now() + 60_000) return account.access_token

  const refreshed = await refreshAccessToken(account.refresh_token)
  const { error } = await supabase
    .from('strava_account')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', account.user_id)
  if (error) throw error
  return refreshed.access_token
}

export async function getAccountByAthlete(
  supabase: SupabaseClient,
  athleteId: number,
): Promise<StravaAccountRow | null> {
  const { data, error } = await supabase
    .from('strava_account')
    .select('user_id, athlete_id, access_token, refresh_token, token_expires_at')
    .eq('athlete_id', athleteId)
    .maybeSingle<StravaAccountRow>()
  if (error) throw error
  return data
}

export async function fetchActivityById(
  accessToken: string,
  id: number,
): Promise<StravaSummaryActivity | null> {
  const res = await fetch(
    `https://www.strava.com/api/v3/activities/${id}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    },
  )
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Strava activity ${id} fetch failed: ${res.status}`)
  }
  return (await res.json()) as StravaSummaryActivity
}

export async function upsertIfRun(
  supabase: SupabaseClient,
  userId: string,
  activity: StravaSummaryActivity,
): Promise<boolean> {
  if (activity.type !== 'Run') return false
  const row = transformActivity(activity, userId)
  const { error } = await supabase
    .from('activities')
    .upsert(row, { onConflict: 'id' })
  if (error) throw error
  return true
}

export async function deleteActivityById(
  supabase: SupabaseClient,
  userId: string,
  id: number,
): Promise<void> {
  const { error } = await supabase
    .from('activities')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw error
}

export async function resyncWindow(
  supabase: SupabaseClient,
  account: StravaAccountRow,
  days: number,
): Promise<number> {
  const accessToken = await ensureFreshToken(supabase, account)
  const after = Math.floor((Date.now() - days * 86400 * 1000) / 1000)
  const PAGE_SIZE = 200
  let page = 1
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
      throw new Error(`Strava list ${res.status}: ${await res.text()}`)
    }
    const batch = (await res.json()) as StravaSummaryActivity[]
    const runs = batch.filter(a => a.type === 'Run')
    if (runs.length > 0) {
      const rows = runs.map(a => transformActivity(a, account.user_id))
      const { error } = await supabase
        .from('activities')
        .upsert(rows, { onConflict: 'id' })
      if (error) throw error
      totalRuns += runs.length
    }
    if (batch.length < PAGE_SIZE) break
    page++
  }
  return totalRuns
}
