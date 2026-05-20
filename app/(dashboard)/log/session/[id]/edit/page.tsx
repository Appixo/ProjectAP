import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth/owner'
import {
  amsterdamWallClockToUtcIso,
} from '@/lib/time/week'

const MODALITIES = [
  // run-modalities (planned & race-week)
  { value: 'run_easy', label: 'Easy run' },
  { value: 'run_threshold', label: 'Threshold run' },
  { value: 'run_tempo', label: 'Tempo run' },
  { value: 'run_long', label: 'Long run' },
  { value: 'run_recovery', label: 'Recovery run' },
  { value: 'run_vo2', label: 'VO2 run' },
  { value: 'run_race', label: 'Race' },
  // cross / strength / other
  { value: 'strength_upper', label: 'Strength upper' },
  { value: 'strength_lower', label: 'Strength lower' },
  { value: 'strength_full', label: 'Strength full' },
  { value: 'football', label: 'Football' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'swimming', label: 'Swimming' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'rest', label: 'Rest' },
  { value: 'other', label: 'Other' },
] as const

const STATUSES = [
  { value: 'planned', label: 'Planned' },
  { value: 'completed', label: 'Completed' },
  { value: 'skipped', label: 'Skipped' },
] as const

interface DescriptionShape {
  target_distance_km?: number
  target_duration_min?: number
  target_hr_min?: number
  target_hr_max?: number
  target_pace_s_per_km_min?: number
  target_pace_s_per_km_max?: number
  reason?: string
}

interface SessionRow {
  id: string
  session_at: string
  session_at_local: string
  modality: string
  duration_min: number | null
  rpe: number | null
  format: string | null
  notes: string | null
  status: 'planned' | 'completed' | 'skipped' | null
  description: DescriptionShape | null
}

function numericOrNull(value: FormDataEntryValue | null): number | null {
  if (value === null) return null
  const s = String(value).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function trimOrNull(value: FormDataEntryValue | null, maxLen: number): string | null {
  if (value === null) return null
  const s = String(value).trim()
  if (s === '' || s.length > maxLen) return s === '' ? null : null
  return s
}

async function updateSession(formData: FormData) {
  'use server'
  const { supabase, user } = await requireOwner()

  const id = String(formData.get('id') ?? '').trim()
  if (!id) redirect('/')

  const sessionAtLocal = String(formData.get('session_at_local') ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(sessionAtLocal)) {
    redirect(`/log/session/${id}/edit?error=invalid_time`)
  }
  const padded =
    sessionAtLocal.length === 16 ? sessionAtLocal + ':00' : sessionAtLocal

  const modality = String(formData.get('modality') ?? '').trim()
  const status = String(formData.get('status') ?? 'planned').trim() as
    | 'planned'
    | 'completed'
    | 'skipped'

  // Description fields — write a description object only when at least one
  // field is set, otherwise leave description = null.
  const desc: DescriptionShape = {}
  const td = numericOrNull(formData.get('target_distance_km'))
  if (td != null) desc.target_distance_km = td
  const tdm = numericOrNull(formData.get('target_duration_min'))
  if (tdm != null) desc.target_duration_min = Math.floor(tdm)
  const hrMin = numericOrNull(formData.get('target_hr_min'))
  if (hrMin != null) desc.target_hr_min = Math.floor(hrMin)
  const hrMax = numericOrNull(formData.get('target_hr_max'))
  if (hrMax != null) desc.target_hr_max = Math.floor(hrMax)
  const paceMin = numericOrNull(formData.get('target_pace_s_per_km_min'))
  if (paceMin != null) desc.target_pace_s_per_km_min = Math.floor(paceMin)
  const paceMax = numericOrNull(formData.get('target_pace_s_per_km_max'))
  if (paceMax != null) desc.target_pace_s_per_km_max = Math.floor(paceMax)
  const reason = trimOrNull(formData.get('reason'), 500)
  if (reason != null) desc.reason = reason
  const descriptionPayload = Object.keys(desc).length === 0 ? null : desc

  let utcIso: string
  try {
    utcIso = amsterdamWallClockToUtcIso(padded)
  } catch {
    redirect(`/log/session/${id}/edit?error=time_conversion_failed`)
  }

  const { error } = await supabase
    .from('training_sessions')
    .update({
      session_at: utcIso,
      session_at_local: padded,
      modality,
      duration_min: numericOrNull(formData.get('duration_min')),
      rpe: numericOrNull(formData.get('rpe')),
      format: trimOrNull(formData.get('format'), 80),
      notes: trimOrNull(formData.get('notes'), 4000),
      status,
      description: descriptionPayload,
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    redirect(`/log/session/${id}/edit?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath('/')
  revalidatePath('/log')
  redirect('/?saved=session')
}

async function deleteSession(formData: FormData) {
  'use server'
  const { supabase, user } = await requireOwner()

  const id = String(formData.get('id') ?? '').trim()
  if (!id) redirect('/')

  await supabase
    .from('training_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/')
  revalidatePath('/log')
  redirect('/?deleted=session')
}

export default async function EditSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const { supabase, user } = await requireOwner()

  const { data: session } = await supabase
    .from('training_sessions')
    .select(
      'id, session_at, session_at_local, modality, duration_min, rpe, format, notes, status, description',
    )
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle<SessionRow>()

  if (!session) notFound()

  const inputClass =
    'rounded border border-border bg-panel text-ink px-3 py-1.5 text-sm outline-none focus:border-border-2'
  // datetime-local expects YYYY-MM-DDTHH:MM (no seconds)
  const sessionAtLocalForInput = session.session_at_local.slice(0, 16)
  const desc = session.description ?? {}
  const isRun = session.modality.startsWith('run_')

  return (
    <div className="space-y-8 max-w-2xl p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink">Edit session</h1>
        <a href="/" className="text-sm text-muted hover:text-ink">
          ← dashboard
        </a>
      </header>

      {sp.error && (
        <p className="text-sm text-warn">Save failed: {sp.error}</p>
      )}

      <form action={updateSession} className="space-y-5">
        <input type="hidden" name="id" value={id} />

        <fieldset className="space-y-3">
          <legend className="text-base font-semibold text-ink mb-1">When</legend>
          <input
            type="datetime-local"
            name="session_at_local"
            defaultValue={sessionAtLocalForInput}
            required
            className={inputClass}
          />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-base font-semibold text-ink mb-1">Modality</legend>
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
                  defaultChecked={session.modality === m.value}
                  required
                  className="accent-[var(--color-accent)]"
                />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-base font-semibold text-ink mb-1">Status</legend>
          <div className="flex gap-4">
            {STATUSES.map(s => (
              <label
                key={s.value}
                className="flex items-center gap-1.5 text-sm text-ink-2"
              >
                <input
                  type="radio"
                  name="status"
                  value={s.value}
                  defaultChecked={(session.status ?? 'planned') === s.value}
                  className="accent-[var(--color-accent)]"
                />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-base font-semibold text-ink mb-1">Logged details</legend>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2">
              <span className="text-sm text-muted w-24">Duration (min)</span>
              <input
                type="number"
                name="duration_min"
                min={1}
                max={600}
                defaultValue={session.duration_min ?? ''}
                className={`${inputClass} w-24`}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-sm text-muted w-24">RPE (1–10)</span>
              <input
                type="number"
                name="rpe"
                min={1}
                max={10}
                defaultValue={session.rpe ?? ''}
                className={`${inputClass} w-20`}
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-sm text-muted">
              Format (e.g. <span className="font-mono">3x12 squats</span>, <span className="font-mono">6v6 2x25min</span>)
            </span>
            <input
              type="text"
              name="format"
              maxLength={80}
              defaultValue={session.format ?? ''}
              className={`${inputClass} w-full`}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted">Notes</span>
            <textarea
              name="notes"
              rows={3}
              defaultValue={session.notes ?? ''}
              className={`${inputClass} w-full`}
            />
          </label>
        </fieldset>

        <details open={isRun} className="border border-border rounded p-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink-2 hover:text-ink">
            Targets (plan description)
          </summary>
          <div className="pt-3 space-y-3">
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2">
                <span className="text-sm text-muted w-28">Target dist (km)</span>
                <input
                  type="number"
                  name="target_distance_km"
                  step="0.1"
                  min={0}
                  max={200}
                  defaultValue={desc.target_distance_km ?? ''}
                  className={`${inputClass} w-24`}
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-sm text-muted w-28">Target dur (min)</span>
                <input
                  type="number"
                  name="target_duration_min"
                  min={1}
                  max={600}
                  defaultValue={desc.target_duration_min ?? ''}
                  className={`${inputClass} w-24`}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2">
                <span className="text-sm text-muted w-28">HR min (bpm)</span>
                <input
                  type="number"
                  name="target_hr_min"
                  min={60}
                  max={220}
                  defaultValue={desc.target_hr_min ?? ''}
                  className={`${inputClass} w-24`}
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-sm text-muted w-28">HR max (bpm)</span>
                <input
                  type="number"
                  name="target_hr_max"
                  min={60}
                  max={220}
                  defaultValue={desc.target_hr_max ?? ''}
                  className={`${inputClass} w-24`}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2">
                <span className="text-sm text-muted w-28">Pace min (s/km)</span>
                <input
                  type="number"
                  name="target_pace_s_per_km_min"
                  min={120}
                  max={900}
                  defaultValue={desc.target_pace_s_per_km_min ?? ''}
                  className={`${inputClass} w-24`}
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-sm text-muted w-28">Pace max (s/km)</span>
                <input
                  type="number"
                  name="target_pace_s_per_km_max"
                  min={120}
                  max={900}
                  defaultValue={desc.target_pace_s_per_km_max ?? ''}
                  className={`${inputClass} w-24`}
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-sm text-muted">Reason / one-line rationale</span>
              <input
                type="text"
                name="reason"
                maxLength={500}
                defaultValue={desc.reason ?? ''}
                className={`${inputClass} w-full`}
              />
            </label>
            <p className="text-xs text-muted">
              Pace is in seconds per km. 5:00/km = 300; 4:30/km = 270. The
              dashboard converts back to mm:ss for display. Leave blank to keep
              the plan generator&rsquo;s default.
            </p>
          </div>
        </details>

        <div className="flex items-center gap-3 pt-4 border-t border-border">
          <button
            type="submit"
            className="rounded bg-ink text-bg px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Save
          </button>
          <a
            href="/"
            className="text-sm text-muted hover:text-ink rounded border border-border px-3 py-2 hover:border-border-2"
          >
            Cancel
          </a>
        </div>
      </form>

      <form action={deleteSession} className="pt-4 border-t border-border">
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          className="text-sm text-warn rounded border border-warn px-3 py-2 hover:bg-warn hover:text-bg"
        >
          Delete session
        </button>
        <p className="text-xs text-muted mt-1">
          Removes the row entirely. Use <span className="text-ink">Skip</span> from the
          dashboard popover instead if you want it to count toward adherence as
          intentionally skipped.
        </p>
      </form>
    </div>
  )
}
