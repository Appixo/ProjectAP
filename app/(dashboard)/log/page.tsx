import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { todayInAmsterdam } from '@/lib/time/week'

interface DailyLogRow {
  user_id: string
  log_date: string
  sleep_hours: number | null
  sleep_score: number | null
  energy: number | null
  habit_strength_done: boolean
  habit_no_alcohol: boolean
  habit_in_bed_on_time: boolean
  notes: string | null
  updated_at: string
}

const HABITS = [
  { name: 'habit_strength_done', label: 'Strength / mobility done' },
  { name: 'habit_no_alcohol', label: 'No alcohol' },
  { name: 'habit_in_bed_on_time', label: 'In bed by target time' },
] as const

function numericOrNull(value: FormDataEntryValue | null): number | null {
  if (value === null) return null
  const s = String(value).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

async function saveLog(formData: FormData) {
  'use server'
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const logDate = String(formData.get('log_date') ?? '').trim()
  if (!logDate) redirect('/log?error=missing_date')

  const notes = String(formData.get('notes') ?? '').trim()

  const { error } = await supabase.from('daily_log').upsert(
    {
      user_id: user.id,
      log_date: logDate,
      sleep_hours: numericOrNull(formData.get('sleep_hours')),
      sleep_score: numericOrNull(formData.get('sleep_score')),
      energy: numericOrNull(formData.get('energy')),
      habit_strength_done: formData.get('habit_strength_done') === 'on',
      habit_no_alcohol: formData.get('habit_no_alcohol') === 'on',
      habit_in_bed_on_time: formData.get('habit_in_bed_on_time') === 'on',
      notes: notes === '' ? null : notes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,log_date' },
  )

  if (error) {
    redirect(`/log?date=${logDate}&error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/log')
  redirect(`/log?date=${logDate}&saved=1`)
}

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string
    saved?: string
    error?: string
  }>
}) {
  const sp = await searchParams
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const todayYmd = todayInAmsterdam()
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayYmd

  const { data: existing } = await supabase
    .from('daily_log')
    .select('*')
    .eq('user_id', user.id)
    .eq('log_date', date)
    .maybeSingle<DailyLogRow>()

  const inputClass =
    'block rounded border border-border bg-panel text-ink px-3 py-2 text-sm outline-none focus:border-border-2'

  return (
    <div className="space-y-6 max-w-xl p-6">
      <h1 className="text-2xl font-semibold text-ink">Daily log</h1>

      <form action={saveLog} className="space-y-6">
        <div className="space-y-1">
          <label htmlFor="log_date" className="text-sm text-muted">
            Date
          </label>
          <input
            id="log_date"
            type="date"
            name="log_date"
            defaultValue={date}
            max={todayYmd}
            required
            className={inputClass}
          />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-base font-semibold text-ink mb-1">Sleep</legend>
          <div className="flex items-center gap-3">
            <label htmlFor="sleep_hours" className="text-sm text-muted w-24">
              Hours
            </label>
            <input
              id="sleep_hours"
              type="number"
              name="sleep_hours"
              step="0.25"
              min="0"
              max="14"
              defaultValue={existing?.sleep_hours ?? ''}
              placeholder="7.5"
              className={`${inputClass} w-28 py-1.5`}
            />
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="sleep_score" className="text-sm text-muted w-24">
              Score
            </label>
            <input
              id="sleep_score"
              type="number"
              name="sleep_score"
              min="0"
              max="100"
              defaultValue={existing?.sleep_score ?? ''}
              placeholder="0–100"
              className={`${inputClass} w-28 py-1.5`}
            />
            <span className="text-xs text-muted">
              Samsung Health sleep score
            </span>
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-base font-semibold text-ink mb-1">Energy</legend>
          <div className="flex gap-4">
            {[1, 2, 3, 4, 5].map(n => (
              <label key={n} className="flex items-center gap-1.5 text-sm text-ink-2">
                <input
                  type="radio"
                  name="energy"
                  value={n}
                  defaultChecked={existing?.energy === n}
                  className="accent-[var(--color-accent)]"
                />
                {n}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">1 = wiped, 5 = ready to race</p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-base font-semibold text-ink mb-1">Habits</legend>
          {HABITS.map(h => (
            <label key={h.name} className="flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                name={h.name}
                defaultChecked={Boolean(existing?.[h.name])}
                className="accent-[var(--color-accent)]"
              />
              {h.label}
            </label>
          ))}
        </fieldset>

        <div className="space-y-1">
          <label htmlFor="notes" className="text-sm text-muted">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={existing?.notes ?? ''}
            className={`${inputClass} w-full`}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded bg-ink text-bg px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Save
          </button>
          {sp.saved === '1' && (
            <span className="text-sm text-success">Saved.</span>
          )}
          {sp.error && (
            <span className="text-sm text-warn">{sp.error}</span>
          )}
        </div>
      </form>
    </div>
  )
}
