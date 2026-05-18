import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveApiAuth, touchTokenLastUsed } from '@/lib/auth/api-auth'
import { amsterdamWallClockToUtcIso } from '@/lib/time/week'

const VALID_MODALITIES = [
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

type Modality = (typeof VALID_MODALITIES)[number]

const VALID_STATUSES = ['planned', 'completed', 'skipped'] as const
type Status = (typeof VALID_STATUSES)[number]

interface DescriptionShape {
  target_distance_km?: number
  target_duration_min?: number
  target_hr_min?: number
  target_hr_max?: number
  target_pace_s_per_km_min?: number
  target_pace_s_per_km_max?: number
  reason?: string
}

interface SessionPayload {
  session_at_local?: unknown
  modality?: unknown
  duration_min?: unknown
  rpe?: unknown
  format?: unknown
  notes?: unknown
  status?: unknown
  description?: unknown
}

interface BuiltRow {
  user_id: string
  session_at: string
  session_at_local: string
  timezone: string
  modality: Modality
  duration_min: number | null
  rpe: number | null
  format: string | null
  notes: string | null
  status: Status
  description: DescriptionShape | null
}

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json(
    detail ? { error, detail } : { error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

function isValidLocalIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)
}

function intOrNull(v: unknown, lo: number, hi: number): number | null | 'invalid' {
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

function numOrNull(
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

function stringOrNull(v: unknown, maxLen: number): string | null | 'invalid' {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return 'invalid'
  const trimmed = v.trim()
  if (trimmed === '') return null
  if (trimmed.length > maxLen) return 'invalid'
  return trimmed
}

// Validate the `description` JSONB payload. All fields optional; unknown
// fields are dropped silently rather than rejected so writers can extend
// the shape gracefully (we surface what's accepted in the schema descriptor).
function descriptionOrNull(
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

  return Object.keys(out).length === 0 ? null : out
}

function buildRow(
  item: SessionPayload,
  userId: string,
): BuiltRow | { error: string; detail?: string } {
  const sessionAtLocal = item.session_at_local
  if (typeof sessionAtLocal !== 'string' || !isValidLocalIso(sessionAtLocal)) {
    return {
      error: 'invalid_session_at_local',
      detail: 'expected YYYY-MM-DDTHH:MM (Amsterdam wall clock)',
    }
  }
  const padded =
    sessionAtLocal.length === 16 ? sessionAtLocal + ':00' : sessionAtLocal

  const modality = item.modality
  if (typeof modality !== 'string' || !VALID_MODALITIES.includes(modality as Modality)) {
    return {
      error: 'invalid_modality',
      detail: `expected one of: ${VALID_MODALITIES.join(', ')}`,
    }
  }

  const duration = intOrNull(item.duration_min, 1, 600)
  if (duration === 'invalid') return { error: 'invalid_duration_min', detail: 'integer 1-600' }
  const rpe = intOrNull(item.rpe, 1, 10)
  if (rpe === 'invalid') return { error: 'invalid_rpe', detail: 'integer 1-10' }
  const format = stringOrNull(item.format, 80)
  if (format === 'invalid') return { error: 'invalid_format', detail: 'max 80 chars' }
  const notes = stringOrNull(item.notes, 4000)
  if (notes === 'invalid') return { error: 'invalid_notes', detail: 'max 4000 chars' }

  // status defaults to 'completed' to preserve existing single-session
  // behaviour. Plan writers must pass 'planned' explicitly.
  let status: Status = 'completed'
  if (item.status !== undefined && item.status !== null && item.status !== '') {
    if (typeof item.status !== 'string' || !VALID_STATUSES.includes(item.status as Status)) {
      return { error: 'invalid_status', detail: `expected one of: ${VALID_STATUSES.join(', ')}` }
    }
    status = item.status as Status
  }

  const description = descriptionOrNull(item.description)
  if (description === 'invalid') {
    return {
      error: 'invalid_description',
      detail:
        'expected object with optional target_distance_km, target_duration_min, target_hr_min, target_hr_max, target_pace_s_per_km_min, target_pace_s_per_km_max, reason',
    }
  }

  let utcIso: string
  try {
    utcIso = amsterdamWallClockToUtcIso(padded)
  } catch {
    return { error: 'time_conversion_failed' }
  }

  return {
    user_id: userId,
    session_at: utcIso,
    session_at_local: padded,
    timezone: 'Europe/Amsterdam',
    modality: modality as Modality,
    duration_min: duration,
    rpe,
    format,
    notes,
    status,
    description,
  }
}

export async function POST(request: NextRequest) {
  const auth = await resolveApiAuth(request)
  if (!auth) return jsonError(401, 'unauthorized')
  if (!auth.canWrite) return jsonError(403, 'token_read_only')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'invalid_json')
  }

  // Accept either a single object or an array of objects so a planner can
  // POST a whole week (or month) of sessions in one call.
  const items: SessionPayload[] = Array.isArray(body)
    ? (body as SessionPayload[])
    : [body as SessionPayload]
  if (items.length === 0) return jsonError(400, 'empty_body')
  if (items.length > 100) return jsonError(400, 'too_many', 'max 100 sessions per request')

  const rows: BuiltRow[] = []
  for (let i = 0; i < items.length; i++) {
    const result = buildRow(items[i], auth.userId)
    if ('error' in result) {
      return jsonError(
        400,
        result.error,
        items.length > 1 ? `item ${i}: ${result.detail ?? ''}`.trim() : result.detail,
      )
    }
    rows.push(result)
  }

  const admin = createSupabaseAdminClient()
  const { data: inserted, error } = await admin
    .from('training_sessions')
    .insert(rows)
    .select(
      'id, session_at, session_at_local, modality, duration_min, rpe, status, description',
    )

  if (error || !inserted) {
    return jsonError(500, 'insert_failed', error?.message)
  }

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  // Mirror the request shape: single-object request → single session;
  // array request → array. Keeps backward compatibility for existing
  // single-session callers.
  return NextResponse.json(
    Array.isArray(body)
      ? { ok: true, sessions: inserted }
      : { ok: true, session: inserted[0] },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}
