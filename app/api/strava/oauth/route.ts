import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { requireOwner } from '@/lib/auth/owner'
import { exchangeCodeForToken } from '@/lib/strava/client'
import { resyncWindow, type StravaAccountRow } from '@/lib/strava/sync'

const STRAVA_OAUTH_STATE_COOKIE = 'strava_oauth_state'

function redirectToSettings(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/settings', request.url)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (errorParam) {
    return redirectToSettings(request, { strava_error: errorParam })
  }
  if (!code || !state) {
    return redirectToSettings(request, { strava_error: 'missing_code' })
  }

  const cookieStore = await cookies()
  const expectedState = cookieStore.get(STRAVA_OAUTH_STATE_COOKIE)?.value
  cookieStore.delete(STRAVA_OAUTH_STATE_COOKIE)
  if (!expectedState || expectedState !== state) {
    return redirectToSettings(request, { strava_error: 'state_mismatch' })
  }

  const { supabase, user } = await requireOwner()

  let token
  try {
    token = await exchangeCodeForToken(code)
  } catch {
    return redirectToSettings(request, { strava_error: 'token_exchange' })
  }

  const accountRow: StravaAccountRow = {
    user_id: user.id,
    athlete_id: token.athlete.id,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_expires_at: new Date(token.expires_at * 1000).toISOString(),
  }

  const { error: upsertError } = await supabase.from('strava_account').upsert({
    ...accountRow,
    scope: 'read,activity:read_all',
    updated_at: new Date().toISOString(),
  })
  if (upsertError) {
    return redirectToSettings(request, { strava_error: 'upsert' })
  }

  // Fire-and-finish: backfill the last 365 days. Inline so we don't return
  // before it finishes — the user expects activities to be ready on /. Wrap
  // in try/catch so a backfill blip doesn't fail the OAuth round-trip.
  let backfilled = 0
  try {
    backfilled = await resyncWindow(supabase, accountRow, 365)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return redirectToSettings(request, {
      strava: 'connected',
      backfill_error: msg.slice(0, 120),
    })
  }

  return redirectToSettings(request, {
    strava: 'connected',
    backfilled: String(backfilled),
  })
}
