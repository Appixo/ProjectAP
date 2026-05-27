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
  type Modality,
  type Status,
} from '@/lib/sessions/validate'

const SELECT_COLS =
  'id, session_at, session_at_local, timezone, modality, duration_min, ' +
  'rpe, format, notes, status, description, matched_activity_id, source'

interface PatchBody {
  session_at_local?: unknown
  modality?: unknown
  duration_min?: unknown
  rpe?: unknown
  format?: unknown
  notes?: unknown
  status?: unknown
  description?: unknown
}

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json(
    detail ? { error, detail } : { error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

// Distinguish "field omitted" from "field explicitly null/empty". Omitted →
// leave untouched. Present → apply (null clears in DB; empty string for text
// fields is normalised to null by stringOrNull).
function has(body: PatchBody, key: keyof PatchBody): boolean {
  return Object.prototype.hasOwnProperty.call(body, key)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await resolveApiAuth(request)
  if (!auth) return jsonError(401, 'unauthorized')
  if (!auth.canWrite) return jsonError(403, 'token_read_only')

  let body: PatchBody
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return jsonError(400, 'invalid_json')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonError(400, 'invalid_body', 'expected JSON object')
  }

  // Build the partial update one field at a time. Only fields explicitly
  // present in the body land in `updates`; everything else stays as-is on
  // the row.
  const updates: Record<string, unknown> = {}

  if (has(body, 'session_at_local')) {
    const s = body.session_at_local
    if (typeof s !== 'string' || !isValidLocalIso(s)) {
      return jsonError(
        400,
        'invalid_session_at_local',
        'expected YYYY-MM-DDTHH:MM (Amsterdam wall clock)',
      )
    }
    const padded = s.length === 16 ? s + ':00' : s
    let utcIso: string
    try {
      utcIso = amsterdamWallClockToUtcIso(padded)
    } catch {
      return jsonError(500, 'time_conversion_failed')
    }
    updates.session_at = utcIso
    updates.session_at_local = padded
    updates.timezone = 'Europe/Amsterdam'
  }

  if (has(body, 'modality')) {
    const m = body.modality
    if (typeof m !== 'string' || !VALID_MODALITIES.includes(m as Modality)) {
      return jsonError(
        400,
        'invalid_modality',
        `expected one of: ${VALID_MODALITIES.join(', ')}`,
      )
    }
    updates.modality = m
  }

  if (has(body, 'duration_min')) {
    const d = intOrNull(body.duration_min, 1, 600)
    if (d === 'invalid') return jsonError(400, 'invalid_duration_min', 'integer 1-600')
    updates.duration_min = d
  }

  if (has(body, 'rpe')) {
    const r = intOrNull(body.rpe, 1, 10)
    if (r === 'invalid') return jsonError(400, 'invalid_rpe', 'integer 1-10')
    updates.rpe = r
  }

  if (has(body, 'format')) {
    const f = stringOrNull(body.format, 80)
    if (f === 'invalid') return jsonError(400, 'invalid_format', 'max 80 chars')
    updates.format = f
  }

  if (has(body, 'notes')) {
    const n = stringOrNull(body.notes, 4000)
    if (n === 'invalid') return jsonError(400, 'invalid_notes', 'max 4000 chars')
    updates.notes = n
  }

  if (has(body, 'status')) {
    const st = body.status
    if (st === null || st === '') {
      // explicit reset → treat as 'completed' default
      updates.status = 'completed'
    } else if (typeof st !== 'string' || !VALID_STATUSES.includes(st as Status)) {
      return jsonError(
        400,
        'invalid_status',
        `expected one of: ${VALID_STATUSES.join(', ')}`,
      )
    } else {
      updates.status = st
    }
  }

  if (has(body, 'description')) {
    // description is replaced whole (no deep-merge) — simpler and predictable.
    // null or {} → clears the JSONB.
    const desc = descriptionOrNull(body.description)
    if (desc === 'invalid') {
      return jsonError(400, 'invalid_description', DESCRIPTION_DETAIL)
    }
    updates.description = desc
  }

  if (Object.keys(updates).length === 0) {
    return jsonError(400, 'no_fields', 'pass at least one updatable field')
  }

  const admin = createSupabaseAdminClient()
  const { data: updated, error } = await admin
    .from('training_sessions')
    .update(updates)
    .eq('id', id)
    .eq('user_id', auth.userId)
    .select(SELECT_COLS)
    .maybeSingle()

  if (error) {
    return jsonError(500, 'update_failed', error.message)
  }
  if (!updated) {
    return jsonError(404, 'not_found')
  }

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json(
    { ok: true, session: updated },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await resolveApiAuth(request)
  if (!auth) return jsonError(401, 'unauthorized')
  if (!auth.canWrite) return jsonError(403, 'token_read_only')

  const admin = createSupabaseAdminClient()
  // Delete-and-return so we can tell "row was here" from "row was never here"
  // without a separate fetch. An already-gone id returns 404 cleanly.
  const { data: deleted, error } = await admin
    .from('training_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', auth.userId)
    .select('id')
    .maybeSingle<{ id: string }>()

  if (error) {
    return jsonError(500, 'delete_failed', error.message)
  }
  if (!deleted) {
    return jsonError(404, 'not_found')
  }

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json(
    { ok: true, deleted: deleted.id },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
