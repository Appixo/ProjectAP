import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth/owner'
import {
  amsterdamWallClockToUtcIso,
  nowAmsterdamLocalForInput,
  todayInAmsterdam,
} from '@/lib/time/week'
import { DailyLogCard, type DailyLogRow } from '@/components/dashboard/DailyLogCard'

interface TrainingSessionRow {
  id: string
  session_at: string
  session_at_local: string
  modality: string
  duration_min: number | null
  rpe: number | null
  format: string | null
  notes: string | null
}

const MODALITIES = [
  { value: 'strength_upper', label: 'Strength upper' },
  { value: 'strength_lower', label: 'Strength lower' },
  { value: 'strength_full', label: 'Strength full' },
  { value: 'football', label: 'Football' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'swimming', label: 'Swimming' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'other', label: 'Other' },
] as const

const MODALITY_LABEL: Record<string, string> = Object.fromEntries(
  MODALITIES.map(m => [m.value, m.label]),
)

function numericOrNull(value: FormDataEntryValue | null): number | null {
  if (value === null) return null
  const s = String(value).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

async function addSession(formData: FormData) {
  'use server'
  const { supabase, user } = await requireOwner()

  const sessionAtLocal = String(formData.get('session_at_local') ?? '').trim()
  const modality = String(formData.get('modality') ?? '').trim()
  if (!sessionAtLocal || !modality) {
    redirect('/log?session_error=missing_fields')
  }

  const utcIso = amsterdamWallClockToUtcIso(sessionAtLocal)
  const padded =
    sessionAtLocal.length === 16 ? sessionAtLocal + ':00' : sessionAtLocal

  const format = String(formData.get('format') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null

  const { error } = await supabase.from('training_sessions').insert({
    user_id: user.id,
    session_at: utcIso,
    session_at_local: padded,
    timezone: 'Europe/Amsterdam',
    modality,
    duration_min: numericOrNull(formData.get('duration_min')),
    rpe: numericOrNull(formData.get('rpe')),
    format,
    notes,
  })

  if (error) {
    redirect(`/log?session_error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/log')
  revalidatePath('/')
  redirect('/log?session_saved=1')
}

async function deleteSession(formData: FormData) {
  'use server'
  const { supabase, user } = await requireOwner()

  const id = String(formData.get('id') ?? '').trim()
  if (!id) redirect('/log')

  await supabase
    .from('training_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/log')
  revalidatePath('/')
  redirect('/log?session_deleted=1')
}

function fmtSessionWhen(localIso: string): string {
  return new Date(localIso + 'Z').toLocaleString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string
    session_saved?: string
    session_error?: string
    session_deleted?: string
  }>
}) {
  const sp = await searchParams
  const { supabase, user } = await requireOwner()

  const todayYmd = todayInAmsterdam()
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayYmd

  const { data: existing } = await supabase
    .from('daily_log')
    .select('*')
    .eq('user_id', user.id)
    .eq('log_date', date)
    .maybeSingle<DailyLogRow>()

  const { data: recentSessions } = await supabase
    .from('training_sessions')
    .select(
      'id, session_at, session_at_local, modality, duration_min, rpe, format, notes',
    )
    .eq('user_id', user.id)
    .order('session_at', { ascending: false })
    .limit(10)
    .returns<TrainingSessionRow[]>()

  const inputClass =
    'block rounded border border-border bg-panel text-ink px-3 py-2 text-sm outline-none focus:border-border-2'

  return (
    <div className="space-y-10 max-w-2xl p-6">
      <h1 className="text-2xl font-semibold text-ink">Daily log</h1>

      <form method="GET" action="/log" className="flex items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="log_date_picker" className="text-sm text-muted">
            Edit date
          </label>
          <input
            id="log_date_picker"
            type="date"
            name="date"
            defaultValue={date}
            max={todayYmd}
            className={`${inputClass} py-1.5`}
          />
        </div>
        <button
          type="submit"
          className="rounded border border-border-2 bg-panel text-ink-2 px-3 py-1.5 text-sm hover:bg-bg"
        >
          Go
        </button>
      </form>

      <DailyLogCard logDate={date} existing={existing ?? null} />

      <section className="space-y-4 pt-4 border-t border-dashed border-border">
        <div>
          <h2 className="text-xl font-semibold text-ink">Log a session</h2>
          <p className="text-sm text-muted">
            Strength, football, mobility — anything not auto-imported from Strava.
          </p>
        </div>

        <form action={addSession} className="space-y-5">
          <div className="space-y-1">
            <label htmlFor="session_at_local" className="text-sm text-muted">
              When
            </label>
            <input
              id="session_at_local"
              type="datetime-local"
              name="session_at_local"
              defaultValue={nowAmsterdamLocalForInput()}
              required
              className={inputClass}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm text-muted mb-1">Modality</legend>
            <div className="flex flex-wrap gap-3">
              {MODALITIES.map(m => (
                <label
                  key={m.value}
                  className="flex items-center gap-1.5 text-sm text-ink-2"
                >
                  <input
                    type="radio"
                    name="modality"
                    value={m.value}
                    required
                    className="accent-[var(--color-accent)]"
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <label htmlFor="duration_min" className="text-sm text-muted">
                Duration (min)
              </label>
              <input
                id="duration_min"
                type="number"
                name="duration_min"
                min="1"
                max="600"
                placeholder="50"
                className={`${inputClass} w-28`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="rpe" className="text-sm text-muted">
                RPE (1–10)
              </label>
              <input
                id="rpe"
                type="number"
                name="rpe"
                min="1"
                max="10"
                placeholder="7"
                className={`${inputClass} w-24`}
              />
            </div>
            <div className="space-y-1 flex-1 min-w-[12rem]">
              <label htmlFor="format" className="text-sm text-muted">
                Format (optional)
              </label>
              <input
                id="format"
                type="text"
                name="format"
                placeholder="6v6 2×25min · upper push/pull · etc."
                maxLength={80}
                className={`${inputClass} w-full`}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="session_notes" className="text-sm text-muted">
              Notes
            </label>
            <textarea
              id="session_notes"
              name="notes"
              rows={3}
              placeholder="Felt heavy after the deload week. Right calf tight."
              className={`${inputClass} w-full`}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded bg-ink text-bg px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Add session
            </button>
            {sp.session_saved === '1' && (
              <span className="text-sm text-success">Session logged.</span>
            )}
            {sp.session_deleted === '1' && (
              <span className="text-sm text-muted">Session deleted.</span>
            )}
            {sp.session_error && (
              <span className="text-sm text-warn">{sp.session_error}</span>
            )}
          </div>
        </form>

        {recentSessions && recentSessions.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Modality</th>
                  <th className="py-2 pr-4 font-medium text-right">Min</th>
                  <th className="py-2 pr-4 font-medium text-right">RPE</th>
                  <th className="py-2 pr-4 font-medium">Notes</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {recentSessions.map(s => (
                  <tr key={s.id} className="border-b border-border text-ink-2 align-top">
                    <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                      {fmtSessionWhen(s.session_at_local)}
                    </td>
                    <td className="py-2 pr-4">
                      {MODALITY_LABEL[s.modality] ?? s.modality}
                    </td>
                    <td className="py-2 pr-4 font-mono text-right">
                      {s.duration_min ?? '—'}
                    </td>
                    <td className="py-2 pr-4 font-mono text-right">
                      {s.rpe ?? '—'}
                    </td>
                    <td className="py-2 pr-4 text-muted">
                      {s.format && (
                        <span className="text-ink-2">{s.format}</span>
                      )}
                      {s.format && s.notes && ' · '}
                      {s.notes}
                    </td>
                    <td className="py-2 text-right">
                      <form action={deleteSession}>
                        <input type="hidden" name="id" value={s.id} />
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
    </div>
  )
}
