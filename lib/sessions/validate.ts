// Shared field validators for training_sessions write endpoints (POST /api/sessions
// and PATCH /api/sessions/[id]). Kept here so the two routes can't drift on
// shape, ranges, or the description JSON spec.

export const VALID_MODALITIES = [
  'strength_upper',
  'strength_lower',
  'strength_full',
  'football',
  'cycling',
  'swimming',
  'mobility',
  'run_easy',
  'run_tempo',
  'run_long',
  'run_threshold',
  'run_vo2',
  'run_race',
  'run_recovery',
  'rest',
  'other',
] as const

export type Modality = (typeof VALID_MODALITIES)[number]

export const VALID_STATUSES = ['planned', 'completed', 'skipped'] as const
export type Status = (typeof VALID_STATUSES)[number]

export interface ExerciseEntry {
  name: string
  sets: number
  reps: string
  weight?: string
  rest_s?: number
}

export interface DescriptionShape {
  target_distance_km?: number
  target_duration_min?: number
  target_hr_min?: number
  target_hr_max?: number
  target_pace_s_per_km_min?: number
  target_pace_s_per_km_max?: number
  reason?: string
  exercises?: ExerciseEntry[]
}

export function isValidLocalIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)
}

export function intOrNull(
  v: unknown,
  lo: number,
  hi: number,
): number | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < lo || v > hi) return 'invalid'
    return v
  }
  if (typeof v === 'string') {
    const n = Number(v)
    if (!Number.isInteger(n) || n < lo || n > hi) return 'invalid'
    return n
  }
  return 'invalid'
}

export function numOrNull(
  v: unknown,
  lo: number,
  hi: number,
): number | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') n = Number(v)
  else return 'invalid'
  if (!Number.isFinite(n) || n < lo || n > hi) return 'invalid'
  return n
}

export function stringOrNull(
  v: unknown,
  maxLen: number,
): string | null | 'invalid' {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return 'invalid'
  const trimmed = v.trim()
  if (trimmed === '') return null
  if (trimmed.length > maxLen) return 'invalid'
  return trimmed
}

// Strength prescription rows: { name, sets, reps, weight, rest_s }. reps and
// weight are STRINGS — prescriptions use ranges and words ("8-12", "10/side",
// "bodyweight", "5-7.5 kg") that a numeric type would mangle. weight + rest_s
// are optional; bodyweight moves and mobility flows often omit them.
function exercisesOrNull(
  v: unknown,
): ExerciseEntry[] | null | 'invalid' {
  if (v === undefined || v === null) return null
  if (!Array.isArray(v)) return 'invalid'
  if (v.length === 0) return null
  if (v.length > 50) return 'invalid'
  const out: ExerciseEntry[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'invalid'
    const item = raw as Record<string, unknown>

    const name = stringOrNull(item.name, 100)
    if (name === 'invalid' || name === null) return 'invalid'

    const sets = intOrNull(item.sets, 1, 50)
    if (sets === 'invalid' || sets === null) return 'invalid'

    const reps = stringOrNull(item.reps, 40)
    if (reps === 'invalid' || reps === null) return 'invalid'

    const entry: ExerciseEntry = { name, sets, reps }

    if (item.weight !== undefined && item.weight !== null && item.weight !== '') {
      const weight = stringOrNull(item.weight, 40)
      if (weight === 'invalid') return 'invalid'
      if (weight !== null) entry.weight = weight
    }

    if (item.rest_s !== undefined && item.rest_s !== null && item.rest_s !== '') {
      const rest = intOrNull(item.rest_s, 0, 1800)
      if (rest === 'invalid') return 'invalid'
      if (rest !== null) entry.rest_s = rest
    }

    out.push(entry)
  }
  return out
}

// Validate the `description` JSONB payload. All fields optional; unknown
// fields are dropped silently rather than rejected so writers can extend
// the shape gracefully (we surface what's accepted in the schema descriptor).
export function descriptionOrNull(
  v: unknown,
): DescriptionShape | null | 'invalid' {
  if (v === undefined || v === null) return null
  if (typeof v !== 'object' || Array.isArray(v)) return 'invalid'
  const obj = v as Record<string, unknown>
  const out: DescriptionShape = {}

  const td = numOrNull(obj.target_distance_km, 0, 200)
  if (td === 'invalid') return 'invalid'
  if (td !== null) out.target_distance_km = td

  const tdm = intOrNull(obj.target_duration_min, 1, 600)
  if (tdm === 'invalid') return 'invalid'
  if (tdm !== null) out.target_duration_min = tdm

  const hrMin = intOrNull(obj.target_hr_min, 60, 220)
  if (hrMin === 'invalid') return 'invalid'
  if (hrMin !== null) out.target_hr_min = hrMin

  const hrMax = intOrNull(obj.target_hr_max, 60, 220)
  if (hrMax === 'invalid') return 'invalid'
  if (hrMax !== null) out.target_hr_max = hrMax

  const paceMin = intOrNull(obj.target_pace_s_per_km_min, 120, 900)
  if (paceMin === 'invalid') return 'invalid'
  if (paceMin !== null) out.target_pace_s_per_km_min = paceMin

  const paceMax = intOrNull(obj.target_pace_s_per_km_max, 120, 900)
  if (paceMax === 'invalid') return 'invalid'
  if (paceMax !== null) out.target_pace_s_per_km_max = paceMax

  const reason = stringOrNull(obj.reason, 500)
  if (reason === 'invalid') return 'invalid'
  if (reason !== null) out.reason = reason

  const exercises = exercisesOrNull(obj.exercises)
  if (exercises === 'invalid') return 'invalid'
  if (exercises !== null) out.exercises = exercises

  return Object.keys(out).length === 0 ? null : out
}

export const DESCRIPTION_DETAIL =
  'expected object with optional target_distance_km, target_duration_min, ' +
  'target_hr_min, target_hr_max, target_pace_s_per_km_min, ' +
  'target_pace_s_per_km_max, reason, exercises[{name, sets, reps, weight?, rest_s?}]'
