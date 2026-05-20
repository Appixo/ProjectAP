import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth/owner'
import { todayInAmsterdam } from '@/lib/time/week'

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
  // legacy fields preserved for backward compat
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

function timeOrNull(value: FormDataEntryValue | null): string | null {
  if (value === null) return null
  const s = String(value).trim()
  // Accept HH:MM or HH:MM:SS. The DB column is `time` which stores either.
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return null
  return s
}

async function saveTodayLog(formData: FormData) {
  'use server'
  const { supabase, user } = await requireOwner()

  const logDate = String(formData.get('log_date') ?? '').trim()
  if (!logDate) return

  const notes = String(formData.get('notes') ?? '').trim()

  await supabase.from('daily_log').upsert(
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

  revalidatePath('/')
}

const HABITS = [
  { name: 'habit_strength_done' as const, label: 'strength' },
  { name: 'habit_no_alcohol' as const, label: 'no-alc' },
  { name: 'habit_in_bed_on_time' as const, label: 'in-bed' },
]

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export async function DailyLogCard() {
  const { supabase, user } = await requireOwner()

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
      <form action={saveTodayLog} className="px-4 py-4 space-y-3">
        <input type="hidden" name="log_date" value={today} />

        <FieldGroup label="Sleep" hint="auto-filled by Tasker">
          <NumInput name="sleep_hours" label="hrs" defaultValue={existing?.sleep_hours} step="0.25" min={0} max={14} width="w-14" />
          <TimeInput name="bedtime" label="bed" defaultValue={existing?.bedtime} />
          <TimeInput name="wake_time" label="wake" defaultValue={existing?.wake_time} />
          <RadioGroup name="sleep_quality_1_5" label="quality" defaultValue={existing?.sleep_quality_1_5} />
        </FieldGroup>

        <FieldGroup label="Body" hint="auto-filled by Tasker">
          <NumInput name="morning_rhr_bpm" label="RHR" defaultValue={existing?.morning_rhr_bpm} min={30} max={120} width="w-14" />
          <NumInput name="hrv_ms" label="HRV" defaultValue={existing?.hrv_ms} min={1} max={200} width="w-14" />
          <NumInput name="body_weight_kg" label="wgt" defaultValue={existing?.body_weight_kg} step="0.1" min={40} max={150} width="w-16" />
        </FieldGroup>

        <FieldGroup label="State">
          <RadioGroup name="mood_1_5" label="mood" defaultValue={existing?.mood_1_5} />
          <RadioGroup name="stress_1_5" label="stress" defaultValue={existing?.stress_1_5} />
        </FieldGroup>

        {/* legacy energy/sleep_score/habits stay hidden but get re-submitted
            so saving doesn't blank already-logged values. */}
        <input type="hidden" name="sleep_score" value={existing?.sleep_score ?? ''} />
        <input type="hidden" name="energy" value={existing?.energy ?? ''} />

        <div className="flex flex-wrap items-center gap-3.5 text-[12px] text-ink-2">
          <span className="text-[12px] text-muted w-[44px]">Habits</span>
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

        <div className="flex items-center gap-2">
          <label htmlFor="dl_notes" className="text-[12px] text-muted w-[44px]">
            Notes
          </label>
          <input
            id="dl_notes"
            type="text"
            name="notes"
            defaultValue={existing?.notes ?? ''}
            placeholder="how the body feels, what hurts, what to remember"
            className="flex-1 font-mono text-[13px] text-ink bg-bg border border-border-2 rounded-[3px] px-2 py-[5px]"
          />
        </div>

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

function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted">{label}</span>
        {hint && <span className="text-[10px] text-faint italic">{hint}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

function NumInput({
  name,
  label,
  defaultValue,
  step,
  min,
  max,
  width = 'w-14',
}: {
  name: string
  label: string
  defaultValue: number | null | undefined
  step?: string
  min?: number
  max?: number
  width?: string
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted">{label}</span>
      <input
        type="number"
        name={name}
        step={step ?? '1'}
        min={min}
        max={max}
        defaultValue={defaultValue ?? ''}
        className={`font-mono text-[12px] text-ink bg-bg border border-border-2 rounded-[3px] px-2 py-[3px] ${width}`}
      />
    </label>
  )
}

function TimeInput({
  name,
  label,
  defaultValue,
}: {
  name: string
  label: string
  defaultValue: string | null | undefined
}) {
  // Strip seconds — Postgres time may serialise as HH:MM:SS but the input
  // expects HH:MM.
  const value = defaultValue ? defaultValue.slice(0, 5) : ''
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted">{label}</span>
      <input
        type="time"
        name={name}
        defaultValue={value}
        className="font-mono text-[12px] text-ink bg-bg border border-border-2 rounded-[3px] px-2 py-[3px] w-[5.5rem]"
      />
    </label>
  )
}

function RadioGroup({
  name,
  label,
  defaultValue,
}: {
  name: string
  label: string
  defaultValue: number | null | undefined
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted">{label}</span>
      <div className="flex gap-1.5 items-center">
        {[1, 2, 3, 4, 5].map(n => (
          <label
            key={n}
            className="inline-flex items-center cursor-pointer"
            title={`${label} ${n}/5`}
          >
            <input
              type="radio"
              name={name}
              value={n}
              defaultChecked={defaultValue === n}
              className="peer sr-only"
            />
            <span className="w-[12px] h-[12px] rounded-full border border-ink-2 peer-checked:bg-ink peer-checked:border-ink" />
          </label>
        ))}
      </div>
    </div>
  )
}
