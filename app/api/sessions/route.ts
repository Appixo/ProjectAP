import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveApiAuth, touchTokenLastUsed } from '@/lib/auth/api-auth'
import { amsterdamWallClockToUtcIso } from '@/lib/time/week'
import {
  DESCRIPTION_DETAIL,
  VALID_MODALITIES,
  VALID_STATUSES,
  descriptionOrNull,
  intOrNull,
  isValidLocalIso,
  stringOrNull,
  type DescriptionShape,
  type Modality,
  type Status,
} from '@/lib/sessions/validate'

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
    return { error: 'invalid_description', detail: DESCRIPTION_DETAIL }
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
