import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshAccessToken } from './client'
import {
  transformActivity,
  type StravaSummaryActivity,
} from './transform'
import { fetchActivityStreams, hrAboveTempoPct } from './streams'
import { modalityToRunType } from '../run/classify'

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
  accessToken?: string,
): Promise<boolean> {
  if (activity.type !== 'Run') return false
  const row = transformActivity(activity, userId)

  // HR-distribution signal: one extra streams call to compute the fraction of
  // moving time above the tempo floor. Best-effort — a stream failure must not
  // block the activity upsert, so we just leave hr_above_tempo_pct null.
  if (accessToken && activity.has_heartrate) {
    try {
      const streams = await fetchActivityStreams(accessToken, activity.id)
      row.hr_above_tempo_pct = hrAboveTempoPct(streams)
    } catch {
      // ignore — classifier falls back to pace/plan signals.
    }
  }

  const { error } = await supabase
    .from('activities')
    .upsert(row, { onConflict: 'id' })
  if (error) throw error

  // Auto-match: if exactly one planned run_* session exists on the same
  // Amsterdam calendar day for this user and is unmatched, flip it to
  // completed and link to this activity. Multiple matches → skip (can't
  // tell which planned session this run fulfils without more signal).
  try {
    await matchPlannedRun(supabase, userId, row.id, row.start_at_local)
  } catch {
    // Matching is best-effort; never let it fail the activity upsert.
  }
  return true
}

export async function matchPlannedRun(
  supabase: SupabaseClient,
  userId: string,
  activityId: number,
  startAtLocal: string, // naive timestamp string, "YYYY-MM-DDTHH:MM:SS"
): Promise<boolean> {
  const ymd = startAtLocal.slice(0, 10)
  // Look for planned run_* sessions on the same Amsterdam calendar day
  // that don't already have a matched activity.
  const { data: candidates, error } = await supabase
    .from('training_sessions')
    .select('id, modality, matched_activity_id')
    .eq('user_id', userId)
    .eq('status', 'planned')
    .like('modality', 'run_%')
    .is('matched_activity_id', null)
    .gte('session_at_local', `${ymd}T00:00:00`)
    .lt('session_at_local', `${ymd}T23:59:59`)
  if (error || !candidates) return false
  if (candidates.length !== 1) return false

  const target = candidates[0]
  const { error: updErr } = await supabase
    .from('training_sessions')
    .update({
      status: 'completed',
      matched_activity_id: activityId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', target.id)
  if (updErr) return false

  // Stamp the planned type onto the activity so the dashboard and the export
  // endpoint read one authoritative run_type instead of re-deriving it from
  // HR/pace (which is what tagged a threshold session "easy" in the first
  // place). Best-effort: the match itself already succeeded.
  const runType = modalityToRunType(target.modality)
  if (runType) {
    await supabase
      .from('activities')
      .update({ run_type: runType })
      .eq('id', activityId)
      .eq('user_id', userId)
  }
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
