import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createHash, randomBytes } from 'crypto'
import { requireOwner } from '@/lib/auth/owner'
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
  can_write: boolean
}

interface GoalsRow {
  primary_goal: string
  primary_event_date: string | null
  secondary_goal: string | null
  secondary_event_date: string | null
  secondary_kind: string | null
  notes: string | null
  updated_at: string
}

interface PersonalBestRow {
  id: string
  distance_m: number
  time_s: number
  achieved_at: string
  event_name: string | null
  notes: string | null
  source: 'logged' | 'derived' | 'synced'
}

const DEFAULT_GOALS: GoalsRow = {
  primary_goal: 'marathon',
  primary_event_date: '2026-11-01',
  secondary_goal: 'football',
  secondary_event_date: '2026-08-11',
  secondary_kind: 'recreational',
  notes:
    'Marathon is the only competitive event. Football is recreational; I will not do ball/technique training. Strength is for injury resilience and general athleticism.',
  updated_at: '',
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
  const { supabase, user } = await requireOwner()
  await supabase.from('strava_account').delete().eq('user_id', user.id)
  redirect('/settings?disconnected=1')
}

async function createExportToken(formData: FormData) {
  'use server'
  const { supabase, user } = await requireOwner()

  const labelRaw = String(formData.get('label') ?? '').trim()
  const label = labelRaw.slice(0, 60) || 'export'
  const canWrite = formData.get('can_write') === 'on'
  const raw = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(raw).digest('hex')

  const { error } = await supabase.from('export_tokens').insert({
    user_id: user.id,
    token_hash: hash,
    label,
    can_write: canWrite,
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
  const { supabase, user } = await requireOwner()

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

async function saveGoals(formData: FormData) {
  'use server'
  const { supabase, user } = await requireOwner()

  const dateOrNull = (raw: FormDataEntryValue | null): string | null => {
    const s = String(raw ?? '').trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
  }
  const trimOrNull = (raw: FormDataEntryValue | null): string | null => {
    const s = String(raw ?? '').trim()
    return s === '' ? null : s
  }

  const primary = String(formData.get('primary_goal') ?? '').trim()
  if (!primary) redirect('/settings?goals_error=missing_primary')

  const { error } = await supabase.from('goals').upsert(
    {
      user_id: user.id,
      primary_goal: primary,
      primary_event_date: dateOrNull(formData.get('primary_event_date')),
      secondary_goal: trimOrNull(formData.get('secondary_goal')),
      secondary_event_date: dateOrNull(formData.get('secondary_event_date')),
      secondary_kind: trimOrNull(formData.get('secondary_kind')),
      notes: trimOrNull(formData.get('notes')),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  if (error) {
    redirect(`/settings?goals_error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath('/settings')
  redirect('/settings?goals_saved=1')
}

async function addPersonalBest(formData: FormData) {
  'use server'
  const { supabase, user } = await requireOwner()

  const distance = Number(formData.get('distance_m'))
  const hours = Number(formData.get('time_h') || 0)
  const minutes = Number(formData.get('time_m') || 0)
  const seconds = Number(formData.get('time_s') || 0)
  const totalSeconds = Math.floor(hours * 3600 + minutes * 60 + seconds)
  const achievedAt = String(formData.get('achieved_at') ?? '').trim()
  const eventName = String(formData.get('event_name') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null

  if (!Number.isFinite(distance) || distance <= 0) {
    redirect('/settings?pb_error=invalid_distance')
  }
  if (totalSeconds <= 0) {
    redirect('/settings?pb_error=invalid_time')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(achievedAt)) {
    redirect('/settings?pb_error=invalid_date')
  }

  const { error } = await supabase.from('personal_bests').insert({
    user_id: user.id,
    distance_m: distance,
    time_s: totalSeconds,
    achieved_at: achievedAt,
    event_name: eventName,
    notes,
    source: 'logged',
  })

  if (error) {
    redirect(`/settings?pb_error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath('/settings')
  revalidatePath('/')
  redirect('/settings?pb_saved=1')
}

async function deletePersonalBest(formData: FormData) {
  'use server'
  const { supabase, user } = await requireOwner()
  const id = String(formData.get('id') ?? '')
  if (!id) redirect('/settings')
  await supabase.from('personal_bests').delete().eq('user_id', user.id).eq('id', id)
  revalidatePath('/settings')
  revalidatePath('/')
  redirect('/settings?pb_deleted=1')
}

async function revokeExportToken(formData: FormData) {
  'use server'
  const { supabase, user } = await requireOwner()

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

function formatTimeFromSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 2)} km`
  return `${meters} m`
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
  const { supabase, user } = await requireOwner()

  const { data: account } = await supabase
    .from('strava_account')
    .select('athlete_id, token_expires_at, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: tokens } = await supabase
    .from('export_tokens')
    .select('token_hash, label, created_at, last_used_at, revoked, can_write')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .returns<ExportTokenRow[]>()

  const { data: goalsRow } = await supabase
    .from('goals')
    .select(
      'primary_goal, primary_event_date, secondary_goal, ' +
        'secondary_event_date, secondary_kind, notes, updated_at',
    )
    .eq('user_id', user.id)
    .maybeSingle<GoalsRow>()

  const { data: pbRows } = await supabase
    .from('personal_bests')
    .select('id, distance_m, time_s, achieved_at, event_name, notes, source')
    .eq('user_id', user.id)
    .order('distance_m', { ascending: true })
    .order('time_s', { ascending: true })
    .returns<PersonalBestRow[]>()

  const goals = goalsRow ?? DEFAULT_GOALS
  const goalsSaved = sp.goals_saved === '1'
  const goalsError =
    typeof sp.goals_error === 'string' ? sp.goals_error : null

  const connected = sp.strava === 'connected'
  const disconnected = sp.disconnected === '1'
  const stravaError =
    typeof sp.strava_error === 'string' ? sp.strava_error : null
  const backfilledCount =
    typeof sp.backfilled === 'string' ? sp.backfilled : null
  const backfillError =
    typeof sp.backfill_error === 'string' ? sp.backfill_error : null

  const justCreatedToken = sp.new_token === '1'
  const tokenError =
    typeof sp.token_error === 'string' ? sp.token_error : null
  const justRevoked = sp.revoked === '1'

  const pbSaved = sp.pb_saved === '1'
  const pbDeleted = sp.pb_deleted === '1'
  const pbError = typeof sp.pb_error === 'string' ? sp.pb_error : null

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

  const inputClass =
    'rounded border border-border bg-panel text-ink px-3 py-1.5 text-sm outline-none focus:border-border-2'

  return (
    <div className="space-y-10 max-w-2xl p-6">
      <h1 className="text-2xl font-semibold text-ink">Settings</h1>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-ink">Marathon plan</h2>
        <p className="text-sm text-muted">
          23-week progression (Mon 2026-05-25 → marathon Sun 2026-11-01). Targets per session
          derive from your current data, not a goal time. The dashboard materialises 4 weeks
          ahead at a time; a weekly cron extends the window.
        </p>
        <a
          href="/settings/plan"
          className="inline-block rounded border border-border bg-panel text-ink px-3 py-1.5 text-sm hover:border-border-2"
        >
          Open plan →
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Goals</h2>
        <p className="text-sm text-muted">
          This block is included in every export. The AI reads it to frame your
          training. Update it whenever priorities shift.
        </p>
        {!goalsRow && (
          <p className="text-xs text-muted">
            No row yet — the form below is pre-filled with sensible defaults. Click save to commit them.
          </p>
        )}

        <form action={saveGoals} className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <label htmlFor="primary_goal" className="text-xs uppercase tracking-[0.1em] text-muted">
                Primary goal
              </label>
              <input
                id="primary_goal"
                name="primary_goal"
                type="text"
                required
                defaultValue={goals.primary_goal}
                className={`${inputClass} w-48`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="primary_event_date" className="text-xs uppercase tracking-[0.1em] text-muted">
                Primary event date
              </label>
              <input
                id="primary_event_date"
                name="primary_event_date"
                type="date"
                defaultValue={goals.primary_event_date ?? ''}
                className={`${inputClass} w-44`}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <label htmlFor="secondary_goal" className="text-xs uppercase tracking-[0.1em] text-muted">
                Secondary goal
              </label>
              <input
                id="secondary_goal"
                name="secondary_goal"
                type="text"
                defaultValue={goals.secondary_goal ?? ''}
                className={`${inputClass} w-48`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="secondary_event_date" className="text-xs uppercase tracking-[0.1em] text-muted">
                Secondary event date
              </label>
              <input
                id="secondary_event_date"
                name="secondary_event_date"
                type="date"
                defaultValue={goals.secondary_event_date ?? ''}
                className={`${inputClass} w-44`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="secondary_kind" className="text-xs uppercase tracking-[0.1em] text-muted">
                Secondary kind
              </label>
              <input
                id="secondary_kind"
                name="secondary_kind"
                type="text"
                placeholder="competitive · recreational · …"
                defaultValue={goals.secondary_kind ?? ''}
                className={`${inputClass} w-48`}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="goals_notes" className="text-xs uppercase tracking-[0.1em] text-muted">
              Notes for the AI
            </label>
            <textarea
              id="goals_notes"
              name="notes"
              rows={4}
              defaultValue={goals.notes ?? ''}
              className={`${inputClass} w-full py-2`}
            />
            <p className="text-xs text-muted">
              Explain the priority, any constraints, and how to weigh the secondary goal. Plain prose is fine.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded bg-ink text-bg px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Save goals
            </button>
            {goalsSaved && <span className="text-sm text-success">Saved.</span>}
            {goalsError && <span className="text-sm text-warn">{goalsError}</span>}
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Personal bests</h2>
        <p className="text-sm text-muted">
          Manual race results. The dashboard auto-derives a best from your Strava activities;
          rows here override that when faster (use this for races where the watch died, or
          historical PBs that predate Strava sync). Pick a standard distance or enter a
          custom one in meters.
        </p>

        <form action={addPersonalBest} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="distance_m" className="text-xs uppercase tracking-[0.1em] text-muted">
              Distance
            </label>
            <select
              id="distance_m"
              name="distance_m"
              required
              defaultValue="5000"
              className={`${inputClass} w-40`}
            >
              <option value="5000">5K (5000 m)</option>
              <option value="10000">10K (10000 m)</option>
              <option value="21097.5">Half (21097.5 m)</option>
              <option value="42195">Marathon (42195 m)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.1em] text-muted">Time</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                name="time_h"
                min={0}
                max={10}
                placeholder="h"
                className={`${inputClass} w-14`}
              />
              <span className="text-muted">:</span>
              <input
                type="number"
                name="time_m"
                min={0}
                max={59}
                placeholder="m"
                className={`${inputClass} w-14`}
              />
              <span className="text-muted">:</span>
              <input
                type="number"
                name="time_s"
                min={0}
                max={59}
                placeholder="s"
                className={`${inputClass} w-14`}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="achieved_at" className="text-xs uppercase tracking-[0.1em] text-muted">
              Date
            </label>
            <input
              id="achieved_at"
              type="date"
              name="achieved_at"
              required
              className={`${inputClass} w-40`}
            />
          </div>
          <div className="space-y-1 flex-1 min-w-[12rem]">
            <label htmlFor="event_name" className="text-xs uppercase tracking-[0.1em] text-muted">
              Event (optional)
            </label>
            <input
              id="event_name"
              type="text"
              name="event_name"
              maxLength={120}
              placeholder="Rotterdam Marathon"
              className={`${inputClass} w-full`}
            />
          </div>
          <button
            type="submit"
            className="rounded bg-ink text-bg px-3 py-2 text-sm font-medium hover:opacity-90"
          >
            Add PB
          </button>
        </form>
        {pbSaved && <p className="text-sm text-success">Saved.</p>}
        {pbDeleted && <p className="text-sm text-muted">Deleted.</p>}
        {pbError && <p className="text-sm text-warn">{pbError}</p>}

        {pbRows && pbRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-2 pr-4 font-medium">Distance</th>
                  <th className="py-2 pr-4 font-medium">Time</th>
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Event</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {pbRows.map(pb => (
                  <tr key={pb.id} className="border-b border-border text-ink-2">
                    <td className="py-2 pr-4">{formatDistance(pb.distance_m)}</td>
                    <td className="py-2 pr-4 font-mono">{formatTimeFromSeconds(pb.time_s)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{pb.achieved_at}</td>
                    <td className="py-2 pr-4">{pb.event_name ?? '—'}</td>
                    <td className="py-2 text-right">
                      <form action={deletePersonalBest}>
                        <input type="hidden" name="id" value={pb.id} />
                        <button
                          type="submit"
                          className="text-xs text-warn hover:underline"
                        >
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Strava</h2>
        {connected && <p className="text-sm text-success">Connected.</p>}
        {backfilledCount && (
          <p className="text-sm text-success">
            Backfilled {backfilledCount} run{backfilledCount === '1' ? '' : 's'} from the last year.
          </p>
        )}
        {backfillError && (
          <p className="text-sm text-warn">
            Backfill failed: {backfillError}. Use the resync button below.
          </p>
        )}
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
        <h2 className="text-lg font-semibold text-ink">API tokens</h2>
        <p className="text-sm text-muted">
          Read tokens fetch all your data as JSON from{' '}
          <code className="font-mono text-ink-2">/api/export?token=…</code>.
          Tokens with <span className="text-ink-2">write scope</span> can also
          POST new sessions to{' '}
          <code className="font-mono text-ink-2">/api/sessions?token=…</code>.
          Treat each token like a password.
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
              Read URL:{' '}
              <code className="font-mono break-all">
                {exportUrlBase}/api/export?token={newTokenValue}
              </code>
            </p>
            <p className="text-xs text-ink-2">
              Write URL (if write scope enabled):{' '}
              <code className="font-mono break-all">
                {exportUrlBase}/api/sessions?token={newTokenValue}
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

        <form action={createExportToken} className="flex flex-wrap items-end gap-3">
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
          <label className="flex items-center gap-2 text-sm text-ink-2 pb-2">
            <input
              type="checkbox"
              name="can_write"
              className="accent-[var(--color-accent)]"
            />
            Allow writing sessions
          </label>
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
                  <th className="py-2 pr-4 font-medium">Scope</th>
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
                    <td className="py-2 pr-4">
                      {t.can_write ? (
                        <span className="text-xs font-mono text-accent">
                          read+write
                        </span>
                      ) : (
                        <span className="text-xs font-mono text-muted">read</span>
                      )}
                    </td>
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

        <details className="text-sm text-ink-2 pt-2">
          <summary className="cursor-pointer text-muted hover:text-ink">
            How to let Claude log sessions for you
          </summary>
          <div className="space-y-2 pt-3">
            <p>
              Create a token with <span className="text-ink">Allow writing sessions</span> checked,
              then paste both URLs into Claude. Claude reads your data from the export URL and
              writes new sessions to the sessions URL.
            </p>
            <pre className="font-mono text-xs bg-panel border border-border rounded p-3 overflow-x-auto whitespace-pre">
{`POST ${exportUrlBase}/api/sessions?token=<RAW>
Content-Type: application/json

{
  "session_at_local": "${new Date().toISOString().slice(0, 16)}",
  "modality": "football",  // strength_upper | strength_lower | strength_full | football | cycling | swimming | mobility | other
  "duration_min": 50,      // optional, 1-600
  "rpe": 7,                // optional, 1-10
  "format": "6v6 2x25min", // optional
  "notes": "..."           // optional
}`}
            </pre>
            <p className="text-xs text-muted">
              The export JSON already includes this schema and the write URL under{' '}
              <code className="font-mono">context.write_endpoints.sessions</code>, so an AI reading
              the export can discover the API on its own.
            </p>
          </div>
        </details>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Automation: Galaxy Watch → daily_log</h2>
        <p className="text-sm text-muted">
          Run a single Tasker task each morning that reads last night&rsquo;s sleep, HRV and
          resting heart rate from Health Connect and POSTs them to the dashboard. After setup,
          the wellness side of training is hands-off — same pattern as Strava&rsquo;s webhook for
          runs.
        </p>

        <div className="text-sm text-ink-2 space-y-2">
          <p>
            Endpoint:{' '}
            <code className="font-mono text-xs">POST {exportUrlBase}/api/daily-logs?token=&lt;WRITE_TOKEN&gt;</code>
          </p>
          <pre className="font-mono text-xs bg-panel border border-border rounded p-3 overflow-x-auto whitespace-pre">
{`{
  "date": "${new Date().toISOString().slice(0, 10)}",
  "sleep_hours": 7.5,           // from Health Connect sleep_session
  "bedtime": "23:30",           // HH:MM local
  "wake_time": "07:00",
  "morning_rhr_bpm": 52,        // from Health Connect resting_heart_rate
  "hrv_ms": 48                  // from Health Connect heart_rate_variability_rmssd
}`}
          </pre>
          <p className="text-xs text-muted">
            Upserts on <code className="font-mono">(user, date)</code> — running multiple times
            the same morning overwrites; partial payloads leave manual fields (mood, soreness,
            body weight) untouched.
          </p>
        </div>

        <div className="text-sm text-ink-2 space-y-2 pt-2">
          <p className="font-semibold text-ink">Setup, step by step:</p>
          <a
            href="https://github.com/Appixo/ProjectAP/blob/main/docs/automation/tasker-galaxy.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded border border-border bg-panel text-ink px-3 py-1.5 text-sm hover:border-border-2"
          >
            docs/automation/tasker-galaxy.md →
          </a>
          <p className="text-xs text-muted">
            Tasker + Health Connect plugin required (Android 14+). If that&rsquo;s more friction
            than typing, use the homescreen shortcut fallback at the bottom of the doc.
          </p>
        </div>
      </section>
    </div>
  )
}
