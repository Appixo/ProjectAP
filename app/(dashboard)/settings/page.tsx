import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createHash, randomBytes } from 'crypto'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getAccountByAthlete, resyncWindow } from '@/lib/strava/sync'

const STRAVA_OAUTH_STATE_COOKIE = 'strava_oauth_state'
const NEW_TOKEN_COOKIE = 'new_export_token'

interface ExportTokenRow {
  token_hash: string
  label: string | null
  created_at: string
  last_used_at: string | null
  revoked: boolean
}

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

async function createExportToken(formData: FormData) {
  'use server'
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const labelRaw = String(formData.get('label') ?? '').trim()
  const label = labelRaw.slice(0, 60) || 'export'
  const raw = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(raw).digest('hex')

  const { error } = await supabase.from('export_tokens').insert({
    user_id: user.id,
    token_hash: hash,
    label,
  })
  if (error) {
    redirect(
      `/settings?token_error=${encodeURIComponent(error.message)}`,
    )
  }

  const cookieStore = await cookies()
  cookieStore.set(NEW_TOKEN_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 120,
    path: '/',
  })

  revalidatePath('/settings')
  redirect('/settings?new_token=1')
}

async function resyncRecent(formData: FormData) {
  'use server'
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const daysRaw = Number(formData.get('days') ?? 7)
  const days = Number.isFinite(daysRaw)
    ? Math.min(90, Math.max(1, Math.floor(daysRaw)))
    : 7

  const { data: account } = await supabase
    .from('strava_account')
    .select('athlete_id')
    .eq('user_id', user.id)
    .maybeSingle<{ athlete_id: number }>()
  if (!account) redirect('/settings?resync_error=not_connected')

  const admin = createSupabaseAdminClient()
  const full = await getAccountByAthlete(admin, account.athlete_id)
  if (!full) redirect('/settings?resync_error=not_connected')

  let count = 0
  let errorMsg: string | null = null
  try {
    count = await resyncWindow(admin, full, days)
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : 'unknown'
  }

  revalidatePath('/settings')
  revalidatePath('/')

  if (errorMsg) {
    redirect(
      `/settings?resync_error=${encodeURIComponent(errorMsg.slice(0, 120))}`,
    )
  }
  redirect(`/settings?resynced=${count}`)
}

async function revokeExportToken(formData: FormData) {
  'use server'
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const hash = String(formData.get('token_hash') ?? '')
  if (!hash) redirect('/settings')

  await supabase
    .from('export_tokens')
    .update({ revoked: true })
    .eq('token_hash', hash)
    .eq('user_id', user.id)

  revalidatePath('/settings')
  redirect('/settings?revoked=1')
}

function shortHash(h: string): string {
  return h.slice(0, 8) + '…'
}

function formatLocal(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/Amsterdam',
  })
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

  const { data: tokens } = await supabase
    .from('export_tokens')
    .select('token_hash, label, created_at, last_used_at, revoked')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .returns<ExportTokenRow[]>()

  const connected = sp.strava === 'connected'
  const disconnected = sp.disconnected === '1'
  const stravaError =
    typeof sp.strava_error === 'string' ? sp.strava_error : null

  const justCreatedToken = sp.new_token === '1'
  const tokenError =
    typeof sp.token_error === 'string' ? sp.token_error : null
  const justRevoked = sp.revoked === '1'

  let newTokenValue: string | null = null
  if (justCreatedToken) {
    const cookieStore = await cookies()
    newTokenValue = cookieStore.get(NEW_TOKEN_COOKIE)?.value ?? null
  }

  const updatedAt = account?.updated_at
    ? new Date(account.updated_at).toLocaleString('en-GB', {
        timeZone: 'Europe/Amsterdam',
      })
    : null

  const exportUrlBase = process.env.NEXT_PUBLIC_APP_URL ?? ''

  return (
    <div className="space-y-10 max-w-2xl p-6">
      <h1 className="text-2xl font-semibold text-ink">Settings</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Strava</h2>
        {connected && <p className="text-sm text-success">Connected.</p>}
        {disconnected && (
          <p className="text-sm text-muted">Disconnected.</p>
        )}
        {stravaError && (
          <p className="text-sm text-warn">Strava error: {stravaError}</p>
        )}

        {account ? (
          <div className="space-y-2 text-sm text-ink-2">
            <p>
              Athlete ID:{' '}
              <span className="font-mono">{account.athlete_id}</span>
            </p>
            {updatedAt && (
              <p className="text-muted">
                Token last updated {updatedAt}. Refreshes automatically.
              </p>
            )}
            <form action={disconnectStrava}>
              <button
                type="submit"
                className="text-sm rounded border border-border bg-panel text-ink px-3 py-1.5 hover:border-border-2"
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

        {account && (
          <form action={resyncRecent} className="flex items-end gap-2 pt-2">
            <div className="space-y-1">
              <label htmlFor="days" className="text-xs uppercase tracking-[0.1em] text-muted">
                Resync last N days
              </label>
              <input
                id="days"
                name="days"
                type="number"
                min={1}
                max={90}
                defaultValue={7}
                className="rounded border border-border bg-panel text-ink px-3 py-1.5 text-sm w-24"
              />
            </div>
            <button
              type="submit"
              className="rounded border border-border bg-panel text-ink px-3 py-2 text-sm hover:border-border-2"
            >
              Resync
            </button>
            {typeof sp.resynced === 'string' && (
              <span className="text-sm text-success">
                Resynced {sp.resynced} runs.
              </span>
            )}
            {typeof sp.resync_error === 'string' && (
              <span className="text-sm text-warn">{sp.resync_error}</span>
            )}
          </form>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Export tokens</h2>
        <p className="text-sm text-muted">
          Use a token to fetch all your data as JSON from{' '}
          <code className="font-mono text-ink-2">/api/export?token=…</code>. Treat each
          token like a password.
        </p>

        {newTokenValue && (
          <div className="rounded border border-accent bg-accent-soft p-3 text-sm space-y-2">
            <p className="font-semibold text-ink">
              Save this token now — it won&rsquo;t be shown again.
            </p>
            <code className="block font-mono break-all text-xs bg-panel border border-border rounded p-2 text-ink">
              {newTokenValue}
            </code>
            <p className="text-xs text-ink-2">
              Full URL:{' '}
              <code className="font-mono break-all">
                {exportUrlBase}/api/export?token={newTokenValue}
              </code>
            </p>
          </div>
        )}
        {tokenError && (
          <p className="text-sm text-warn">Token error: {tokenError}</p>
        )}
        {justRevoked && (
          <p className="text-sm text-muted">Token revoked.</p>
        )}

        <form action={createExportToken} className="flex items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="label" className="text-sm text-muted">
              Label
            </label>
            <input
              id="label"
              name="label"
              type="text"
              placeholder="e.g. claude-analysis"
              maxLength={60}
              className="rounded border border-border bg-panel text-ink px-3 py-1.5 text-sm w-64"
            />
          </div>
          <button
            type="submit"
            className="rounded bg-ink text-bg px-3 py-2 text-sm font-medium hover:opacity-90"
          >
            Create token
          </button>
        </form>

        {tokens && tokens.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-2 pr-4 font-medium">Label</th>
                  <th className="py-2 pr-4 font-medium">Hash</th>
                  <th className="py-2 pr-4 font-medium">Created</th>
                  <th className="py-2 pr-4 font-medium">Last used</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {tokens.map(t => (
                  <tr key={t.token_hash} className="border-b border-border text-ink-2">
                    <td className="py-2 pr-4">{t.label ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {shortHash(t.token_hash)}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {formatLocal(t.created_at)}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {formatLocal(t.last_used_at)}
                    </td>
                    <td className="py-2 text-right">
                      {t.revoked ? (
                        <span className="text-xs text-muted">revoked</span>
                      ) : (
                        <form action={revokeExportToken}>
                          <input
                            type="hidden"
                            name="token_hash"
                            value={t.token_hash}
                          />
                          <button
                            type="submit"
                            className="text-xs text-warn hover:underline"
                          >
                            Revoke
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
