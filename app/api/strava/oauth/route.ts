import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { exchangeCodeForToken } from '@/lib/strava/client'

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

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  let token
  try {
    token = await exchangeCodeForToken(code)
  } catch {
    return redirectToSettings(request, { strava_error: 'token_exchange' })
  }

  const { error: upsertError } = await supabase.from('strava_account').upsert({
    user_id: user.id,
    athlete_id: token.athlete.id,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_expires_at: new Date(token.expires_at * 1000).toISOString(),
    scope: 'read,activity:read_all',
    updated_at: new Date().toISOString(),
  })
  if (upsertError) {
    return redirectToSettings(request, { strava_error: 'upsert' })
  }

  return redirectToSettings(request, { strava: 'connected' })
}
