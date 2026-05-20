import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth/owner'
import {
  amsterdamWallClockToUtcIso,
  nowAmsterdamLocalForInput,
  todayInAmsterdam,
} from '@/lib/time/week'

interface DailyLogRow {
  user_id: string
  log_date: string
  sleep_hours: number | null
  sleep_quality_1_5: number | null
  bedtime: string | null
  wake_time: string | null
  morning_rhr_bpm: number | null
  hrv_ms: number | null
  body_weight_kg: number | null
  mood_1_5: number | null
  stress_1_5: number | null
  sleep_score: number | null
  energy: number | null
  habit_strength_done: boolean
  habit_no_alcohol: boolean
  habit_in_bed_on_time: boolean
  notes: string | null
  updated_at: string
}

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

const HABITS = [
  { name: 'habit_strength_done', label: 'Strength / mobility done' },
  { name: 'habit_no_alcohol', label: 'No alcohol' },
  { name: 'habit_in_bed_on_time', label: 'In bed by target time' },
] as const

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

function timeOrNull(value: FormDataEntryValue | null): string | null {
  if (value === null) return null
  const s = String(value).trim()
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return null
  return s
}

async function saveLog(formData: FormData) {
  'use server'
  const { supabase, user } = await requireOwner()

  const logDate = String(formData.get('log_date') ?? '').trim()
  if (!logDate) redirect('/log?error=missing_date')

  const notes = String(formData.get('notes') ?? '').trim()

  const { error } = await supabase.from('daily_log').upsert(
    {
      user_id: user.id,
      log_date: logDate,
      sleep_hours: numericOrNull(formData.get('sleep_hours')),
      sleep_quality_1_5: numericOrNull(formData.get('sleep_quality_1_5')),
      bedtime: timeOrNull(formData.get('bedtime')),
      wake_time: timeOrNull(formData.get('wake_time')),
      morning_rhr_bpm: numericOrNull(formData.get('morning_rhr_bpm')),
      hrv_ms: numericOrNull(formData.get('hrv_ms')),
      body_weight_kg: numericOrNull(formData.get('body_weight_kg')),
      mood_1_5: numericOrNull(formData.get('mood_1_5')),
      stress_1_5: numericOrNull(formData.get('stress_1_5')),
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
    saved?: string
    error?: string
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
          <p className="text-xs text-muted -mt-1">
            Hours / bedtime / wake / RHR / HRV auto-fill via Tasker; edit if wrong.
          </p>
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
          <div className="flex items-center gap-3">
            <label htmlFor="sleep_quality_1_5" className="text-sm text-muted w-24">
              Quality
            </label>
            <div className="flex gap-3">
              {[1, 2, 3, 4, 5].map(n => (
                <label key={n} className="flex items-center gap-1 text-sm text-ink-2">
                  <input
                    type="radio"
                    name="sleep_quality_1_5"
                    value={n}
                    defaultChecked={existing?.sleep_quality_1_5 === n}
                    className="accent-[var(--color-accent)]"
                  />
                  {n}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="bedtime" className="text-sm text-muted w-24">
              Bedtime
            </label>
            <input
              id="bedtime"
              type="time"
              name="bedtime"
              defaultValue={existing?.bedtime ? existing.bedtime.slice(0, 5) : ''}
              className={`${inputClass} w-28 py-1.5`}
            />
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="wake_time" className="text-sm text-muted w-24">
              Wake
            </label>
            <input
              id="wake_time"
              type="time"
              name="wake_time"
              defaultValue={existing?.wake_time ? existing.wake_time.slice(0, 5) : ''}
              className={`${inputClass} w-28 py-1.5`}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-base font-semibold text-ink mb-1">Body</legend>
          <div className="flex items-center gap-3">
            <label htmlFor="morning_rhr_bpm" className="text-sm text-muted w-24">
              RHR (bpm)
            </label>
            <input
              id="morning_rhr_bpm"
              type="number"
              name="morning_rhr_bpm"
              min="30"
              max="120"
              defaultValue={existing?.morning_rhr_bpm ?? ''}
              placeholder="52"
              className={`${inputClass} w-28 py-1.5`}
            />
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="hrv_ms" className="text-sm text-muted w-24">
              HRV (ms)
            </label>
            <input
              id="hrv_ms"
              type="number"
              name="hrv_ms"
              min="1"
              max="200"
              defaultValue={existing?.hrv_ms ?? ''}
              placeholder="48"
              className={`${inputClass} w-28 py-1.5`}
            />
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="body_weight_kg" className="text-sm text-muted w-24">
              Weight (kg)
            </label>
            <input
              id="body_weight_kg"
              type="number"
              name="body_weight_kg"
              step="0.1"
              min="40"
              max="150"
              defaultValue={existing?.body_weight_kg ?? ''}
              placeholder="76.2"
              className={`${inputClass} w-28 py-1.5`}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-base font-semibold text-ink mb-1">State</legend>
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted w-24">Energy</label>
            <div className="flex gap-3">
              {[1, 2, 3, 4, 5].map(n => (
                <label key={n} className="flex items-center gap-1 text-sm text-ink-2">
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
            <span className="text-xs text-muted">1 wiped → 5 race-ready</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted w-24">Mood</label>
            <div className="flex gap-3">
              {[1, 2, 3, 4, 5].map(n => (
                <label key={n} className="flex items-center gap-1 text-sm text-ink-2">
                  <input
                    type="radio"
                    name="mood_1_5"
                    value={n}
                    defaultChecked={existing?.mood_1_5 === n}
                    className="accent-[var(--color-accent)]"
                  />
                  {n}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted w-24">Stress</label>
            <div className="flex gap-3">
              {[1, 2, 3, 4, 5].map(n => (
                <label key={n} className="flex items-center gap-1 text-sm text-ink-2">
                  <input
                    type="radio"
                    name="stress_1_5"
                    value={n}
                    defaultChecked={existing?.stress_1_5 === n}
                    className="accent-[var(--color-accent)]"
                  />
                  {n}
                </label>
              ))}
            </div>
          </div>
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
