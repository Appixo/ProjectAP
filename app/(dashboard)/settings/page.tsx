import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { randomBytes } from 'crypto'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const STRAVA_OAUTH_STATE_COOKIE = 'strava_oauth_state'

async function connectStrava() {
  'use server'
  const state = randomBytes(32).toString('hex')
  const cookieStore = await cookies()
  cookieStore.set(STRAVA_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/strava/oauth`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state,
  })
  redirect(`https://www.strava.com/oauth/authorize?${params.toString()}`)
}

async function disconnectStrava() {
  'use server'
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('strava_account').delete().eq('user_id', user.id)
  redirect('/settings?disconnected=1')
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: account } = await supabase
    .from('strava_account')
    .select('athlete_id, token_expires_at, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  const connected = sp.strava === 'connected'
  const disconnected = sp.disconnected === '1'
  const stravaError =
    typeof sp.strava_error === 'string' ? sp.strava_error : null

  const updatedAt = account?.updated_at
    ? new Date(account.updated_at).toLocaleString('en-GB', {
        timeZone: 'Europe/Amsterdam',
      })
    : null

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Strava</h2>
        {connected && (
          <p className="text-sm text-green-700">Connected.</p>
        )}
        {disconnected && (
          <p className="text-sm text-neutral-600">Disconnected.</p>
        )}
        {stravaError && (
          <p className="text-sm text-red-600">Strava error: {stravaError}</p>
        )}

        {account ? (
          <div className="space-y-2 text-sm">
            <p>
              Athlete ID: <span className="font-mono">{account.athlete_id}</span>
            </p>
            {updatedAt && (
              <p className="text-neutral-600">
                Token last updated {updatedAt}. Refreshes automatically.
              </p>
            )}
            <form action={disconnectStrava}>
              <button
                type="submit"
                className="text-sm rounded border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100"
              >
                Disconnect Strava
              </button>
            </form>
          </div>
        ) : (
          <form action={connectStrava}>
            <button
              type="submit"
              className="rounded bg-[#fc4c02] text-white px-4 py-2"
            >
              Connect Strava
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
