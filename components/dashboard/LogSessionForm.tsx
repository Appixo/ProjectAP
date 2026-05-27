'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

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

interface ExerciseRow {
  /** Stable key so the React inputs don't lose focus across re-renders. */
  key: number
  name: string
  sets: string
  reps: string
  weight: string
  rest_s: string
}

interface LastSessionResponse {
  ok: true
  session: {
    modality: string
    duration_min: number | null
    format: string | null
    description: {
      exercises?: {
        name: string
        sets: number
        reps: string
        weight?: string
        rest_s?: number
      }[]
    } | null
  }
}

function emptyRow(key: number): ExerciseRow {
  return { key, name: '', sets: '', reps: '', weight: '', rest_s: '' }
}

export interface LogSessionFormProps {
  /** Pre-formatted YYYY-MM-DDTHH:MM for the datetime-local input. */
  defaultDateTimeLocal: string
}

export function LogSessionForm({ defaultDateTimeLocal }: LogSessionFormProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [modality, setModality] = useState<string>('')
  const [sessionAtLocal, setSessionAtLocal] = useState(defaultDateTimeLocal)
  const [durationMin, setDurationMin] = useState('')
  const [rpe, setRpe] = useState('')
  const [format, setFormat] = useState('')
  const [notes, setNotes] = useState('')

  // Exercises start empty. "Repeat last" replaces; "Add exercise" appends a row.
  // nextKey is a monotonic counter for stable React keys.
  const [exercises, setExercises] = useState<ExerciseRow[]>([])
  const [nextKey, setNextKey] = useState(1)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitOk, setSubmitOk] = useState(false)

  const [repeatLoading, setRepeatLoading] = useState(false)
  const [repeatMsg, setRepeatMsg] = useState<string | null>(null)

  function addRow() {
    setExercises(rows => [...rows, emptyRow(nextKey)])
    setNextKey(k => k + 1)
  }
  function removeRow(key: number) {
    setExercises(rows => rows.filter(r => r.key !== key))
  }
  function updateRow(key: number, patch: Partial<ExerciseRow>) {
    setExercises(rows => rows.map(r => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function repeatLast() {
    if (!modality) {
      setRepeatMsg('Pick a modality first.')
      return
    }
    setRepeatLoading(true)
    setRepeatMsg(null)
    try {
      const res = await fetch(
        `/api/sessions/last?modality=${encodeURIComponent(modality)}`,
        { cache: 'no-store' },
      )
      if (res.status === 404) {
        setRepeatMsg(`No prior ${MODALITY_LABEL[modality] ?? modality} session yet.`)
        return
      }
      if (!res.ok) {
        const text = await res.text()
        setRepeatMsg(`Lookup failed: ${text || res.status}`)
        return
      }
      const data = (await res.json()) as LastSessionResponse
      // Only the three fields the spec calls out: format, duration_min,
      // description.exercises. Everything else (notes, rpe, time, reason)
      // is conceptually about the current session, not the template.
      setFormat(data.session.format ?? '')
      setDurationMin(
        data.session.duration_min != null ? String(data.session.duration_min) : '',
      )
      const src = data.session.description?.exercises ?? []
      let key = nextKey
      const rows: ExerciseRow[] = src.map(ex => ({
        key: key++,
        name: ex.name,
        sets: String(ex.sets),
        reps: ex.reps,
        weight: ex.weight ?? '',
        rest_s: ex.rest_s != null ? String(ex.rest_s) : '',
      }))
      setExercises(rows)
      setNextKey(key)
      setRepeatMsg(
        rows.length > 0
          ? `Prefilled ${rows.length} exercise${rows.length === 1 ? '' : 's'} from last session.`
          : 'Prefilled (last session had no exercises).',
      )
    } catch (err) {
      setRepeatMsg(err instanceof Error ? err.message : 'fetch failed')
    } finally {
      setRepeatLoading(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setSubmitOk(false)
    if (!modality) {
      setSubmitError('Pick a modality.')
      return
    }
    if (!sessionAtLocal) {
      setSubmitError('Pick a time.')
      return
    }

    // Build the exercises payload. Drop rows with no name (placeholder rows
    // the user added but never filled in). For kept rows, validate locally
    // so we surface errors before the round-trip; the API also validates.
    const exercisesPayload: {
      name: string
      sets: number
      reps: string
      weight?: string
      rest_s?: number
    }[] = []
    for (const row of exercises) {
      if (!row.name.trim()) continue
      const sets = Number(row.sets)
      if (!Number.isInteger(sets) || sets < 1 || sets > 50) {
        setSubmitError(`Exercise "${row.name.trim()}": sets must be an integer 1-50.`)
        return
      }
      if (!row.reps.trim()) {
        setSubmitError(`Exercise "${row.name.trim()}": reps is required (e.g. "8-12").`)
        return
      }
      const entry: {
        name: string
        sets: number
        reps: string
        weight?: string
        rest_s?: number
      } = {
        name: row.name.trim(),
        sets,
        reps: row.reps.trim(),
      }
      if (row.weight.trim()) entry.weight = row.weight.trim()
      if (row.rest_s.trim()) {
        const rest = Number(row.rest_s)
        if (!Number.isInteger(rest) || rest < 0 || rest > 1800) {
          setSubmitError(`Exercise "${row.name.trim()}": rest_s must be 0-1800.`)
          return
        }
        entry.rest_s = rest
      }
      exercisesPayload.push(entry)
    }

    const description = exercisesPayload.length > 0 ? { exercises: exercisesPayload } : undefined

    const body: Record<string, unknown> = {
      session_at_local: sessionAtLocal,
      modality,
    }
    if (durationMin.trim()) body.duration_min = Number(durationMin)
    if (rpe.trim()) body.rpe = Number(rpe)
    if (format.trim()) body.format = format.trim()
    if (notes.trim()) body.notes = notes.trim()
    if (description) body.description = description

    setSubmitting(true)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok: true }
        | { error: string; detail?: string }
        | null
      if (!res.ok || !data || !('ok' in data)) {
        const msg = data && 'error' in data
          ? `${data.error}${data.detail ? `: ${data.detail}` : ''}`
          : `http ${res.status}`
        setSubmitError(msg)
        return
      }
      setSubmitOk(true)
      // Reset the volatile fields; keep modality + format + exercises so the
      // user can log another similar session quickly (common pattern for
      // back-to-back strength + mobility, or two football matches in a day).
      setRpe('')
      setDurationMin('')
      setNotes('')
      // Refresh the page so the recent-sessions table picks up the new row.
      startTransition(() => router.refresh())
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'block rounded border border-border bg-panel text-ink px-3 py-2 text-sm outline-none focus:border-border-2'
  const smallInputClass =
    'rounded border border-border bg-panel text-ink px-2 py-1 text-xs outline-none focus:border-border-2'

  const repeatLabel = modality
    ? `Repeat last ${MODALITY_LABEL[modality] ?? modality}`
    : 'Repeat last'

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-1">
        <label htmlFor="session_at_local" className="text-sm text-muted">
          When
        </label>
        <input
          id="session_at_local"
          type="datetime-local"
          value={sessionAtLocal}
          onChange={e => setSessionAtLocal(e.target.value)}
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
                checked={modality === m.value}
                onChange={() => setModality(m.value)}
                className="accent-[var(--color-accent)]"
              />
              {m.label}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={repeatLast}
            disabled={repeatLoading || !modality}
            className="rounded border border-border bg-panel text-ink-2 px-3 py-1 text-xs hover:border-border-2 hover:text-ink disabled:opacity-50"
          >
            {repeatLoading ? 'Loading…' : repeatLabel}
          </button>
          {repeatMsg && (
            <span className="text-xs text-muted">{repeatMsg}</span>
          )}
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
            min={1}
            max={600}
            value={durationMin}
            onChange={e => setDurationMin(e.target.value)}
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
            min={1}
            max={10}
            value={rpe}
            onChange={e => setRpe(e.target.value)}
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
            value={format}
            onChange={e => setFormat(e.target.value)}
            placeholder="6v6 2×25min · upper push/pull · etc."
            maxLength={80}
            className={`${inputClass} w-full`}
          />
        </div>
      </div>

      <fieldset className="space-y-2">
        <div className="flex items-baseline justify-between">
          <legend className="text-sm text-muted">Exercises (optional)</legend>
          <button
            type="button"
            onClick={addRow}
            className="text-xs text-ink-2 hover:text-ink border border-border rounded px-2 py-0.5 hover:border-border-2"
          >
            + Add exercise
          </button>
        </div>

        {exercises.length === 0 ? (
          <p className="text-xs text-faint">
            None. Use this for strength sessions instead of dumping the workout
            into notes — name, sets, reps, weight, rest.
          </p>
        ) : (
          <div className="space-y-1.5">
            <div className="hidden md:grid grid-cols-[1fr_4rem_4.5rem_6rem_4.5rem_2rem] gap-2 text-[10px] uppercase tracking-[0.06em] text-muted px-1">
              <span>Name</span>
              <span className="text-right">Sets</span>
              <span className="text-right">Reps</span>
              <span className="text-right">Weight</span>
              <span className="text-right">Rest (s)</span>
              <span />
            </div>
            {exercises.map(row => (
              <div
                key={row.key}
                className="grid grid-cols-[1fr_4rem_4.5rem_6rem_4.5rem_2rem] gap-2"
              >
                <input
                  type="text"
                  value={row.name}
                  onChange={e => updateRow(row.key, { name: e.target.value })}
                  placeholder="Back squat"
                  maxLength={100}
                  className={`${smallInputClass} w-full`}
                />
                <input
                  type="number"
                  value={row.sets}
                  onChange={e => updateRow(row.key, { sets: e.target.value })}
                  placeholder="4"
                  min={1}
                  max={50}
                  className={`${smallInputClass} text-right`}
                />
                <input
                  type="text"
                  value={row.reps}
                  onChange={e => updateRow(row.key, { reps: e.target.value })}
                  placeholder="8-12"
                  maxLength={40}
                  className={`${smallInputClass} text-right`}
                />
                <input
                  type="text"
                  value={row.weight}
                  onChange={e => updateRow(row.key, { weight: e.target.value })}
                  placeholder="80 kg"
                  maxLength={40}
                  className={`${smallInputClass} text-right`}
                />
                <input
                  type="number"
                  value={row.rest_s}
                  onChange={e => updateRow(row.key, { rest_s: e.target.value })}
                  placeholder="120"
                  min={0}
                  max={1800}
                  className={`${smallInputClass} text-right`}
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  aria-label={`Remove ${row.name || 'exercise'}`}
                  className="text-muted hover:text-warn text-sm"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="session_notes" className="text-sm text-muted">
          Notes
        </label>
        <textarea
          id="session_notes"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Felt heavy after the deload week. Right calf tight."
          className={`${inputClass} w-full`}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-ink text-bg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add session'}
        </button>
        {submitOk && (
          <span className="text-sm text-success">Session logged.</span>
        )}
        {submitError && (
          <span className="text-sm text-warn">{submitError}</span>
        )}
      </div>
    </form>
  )
}
