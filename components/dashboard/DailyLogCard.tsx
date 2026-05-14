import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
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

function numericOrNull(value: FormDataEntryValue | null): number | null {
  if (value === null) return null
  const s = String(value).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

async function saveTodayLog(formData: FormData) {
  'use server'
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const logDate = String(formData.get('log_date') ?? '').trim()
  if (!logDate) return

  const notes = String(formData.get('notes') ?? '').trim()

  await supabase.from('daily_log').upsert(
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

  revalidatePath('/')
}

const HABITS = [
  { name: 'habit_strength_done' as const, label: 'strength' },
  { name: 'habit_no_alcohol' as const, label: 'no-alc' },
  { name: 'habit_in_bed_on_time' as const, label: 'in-bed' },
]

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export async function DailyLogCard() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const today = todayInAmsterdam()
  const { data: existing } = await supabase
    .from('daily_log')
    .select('*')
    .eq('user_id', user.id)
    .eq('log_date', today)
    .maybeSingle<DailyLogRow>()

  const weekday = WEEKDAY[new Date(today + 'T12:00:00Z').getUTCDay()]
  const savedAt = existing?.updated_at
    ? new Date(existing.updated_at).toLocaleTimeString('en-GB', {
        timeZone: 'Europe/Amsterdam',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <div className="card bg-panel border border-border rounded-[4px]">
      <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
          Daily log · {weekday}
        </h2>
        {savedAt && (
          <span className="font-mono text-[11px] text-success -tracking-[0.01em]">
            ✓ Saved {savedAt}
          </span>
        )}
      </div>
      <form
        action={saveTodayLog}
        className="px-4 py-4 grid grid-cols-[84px_1fr] gap-x-3 gap-y-2.5 items-center"
      >
        <input type="hidden" name="log_date" value={today} />

        <label htmlFor="dl_sleep_hours" className="text-[12px] text-muted">
          Sleep hrs
        </label>
        <div>
          <input
            id="dl_sleep_hours"
            type="number"
            step="0.25"
            min="0"
            max="14"
            name="sleep_hours"
            defaultValue={existing?.sleep_hours ?? ''}
            className="font-mono text-[13px] text-ink bg-bg border border-border-2 rounded-[3px] px-2 py-[5px] w-16"
          />
        </div>

        <label htmlFor="dl_sleep_score" className="text-[12px] text-muted">
          Sleep score
        </label>
        <div>
          <input
            id="dl_sleep_score"
            type="number"
            min="0"
            max="100"
            name="sleep_score"
            defaultValue={existing?.sleep_score ?? ''}
            className="font-mono text-[13px] text-ink bg-bg border border-border-2 rounded-[3px] px-2 py-[5px] w-16"
          />
        </div>

        <span className="text-[12px] text-muted">Energy</span>
        <div className="flex gap-1.5 items-center">
          {[1, 2, 3, 4, 5].map(n => (
            <label
              key={n}
              className="inline-flex items-center cursor-pointer"
              title={`Energy ${n}/5`}
            >
              <input
                type="radio"
                name="energy"
                value={n}
                defaultChecked={existing?.energy === n}
                className="peer sr-only"
              />
              <span className="w-[14px] h-[14px] rounded-full border border-ink-2 peer-checked:bg-ink peer-checked:border-ink" />
            </label>
          ))}
        </div>

        <span className="text-[12px] text-muted">Habits</span>
        <div className="flex flex-wrap gap-3.5 items-center text-[12px] text-ink-2">
          {HABITS.map(h => (
            <label
              key={h.name}
              className="inline-flex items-center gap-1.5 cursor-pointer"
            >
              <input
                type="checkbox"
                name={h.name}
                defaultChecked={Boolean(existing?.[h.name])}
                className="peer sr-only"
              />
              <span className="w-[14px] h-[14px] border border-ink-2 rounded-[2px] inline-block relative peer-checked:bg-ink peer-checked:border-ink peer-checked:after:content-[''] peer-checked:after:absolute peer-checked:after:left-[3px] peer-checked:after:top-[0px] peer-checked:after:w-[4px] peer-checked:after:h-[8px] peer-checked:after:border-r-[1.5px] peer-checked:after:border-b-[1.5px] peer-checked:after:border-panel peer-checked:after:rotate-45" />
              {h.label}
            </label>
          ))}
        </div>

        <label
          htmlFor="dl_notes"
          className="text-[12px] text-muted self-start pt-1.5"
        >
          Notes
        </label>
        <div>
          <input
            id="dl_notes"
            type="text"
            name="notes"
            defaultValue={existing?.notes ?? ''}
            placeholder="how the body feels, what hurts, what to remember"
            className="font-mono text-[13px] text-ink bg-bg border border-border-2 rounded-[3px] px-2 py-[5px] w-full"
          />
        </div>

        <div />
        <div className="pt-1">
          <button
            type="submit"
            className="font-mono text-[11px] text-ink-2 border border-border-2 rounded-[3px] px-2.5 py-1 bg-panel hover:bg-bg"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
