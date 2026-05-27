import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth/owner'
import {
  nowAmsterdamLocalForInput,
  todayInAmsterdam,
} from '@/lib/time/week'
import { DailyLogCard, type DailyLogRow } from '@/components/dashboard/DailyLogCard'
import { LogSessionForm } from '@/components/dashboard/LogSessionForm'

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

const MODALITY_LABEL: Record<string, string> = {
  strength_upper: 'Strength upper',
  strength_lower: 'Strength lower',
  strength_full: 'Strength full',
  football: 'Football',
  cycling: 'Cycling',
  swimming: 'Swimming',
  mobility: 'Mobility',
  other: 'Other',
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

        <LogSessionForm defaultDateTimeLocal={nowAmsterdamLocalForInput()} />
        {sp.session_deleted === '1' && (
          <p className="text-sm text-muted">Session deleted.</p>
        )}

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
