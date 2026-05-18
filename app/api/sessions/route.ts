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
  'other',
] as const

type Modality = (typeof VALID_MODALITIES)[number]

interface SessionPayload {
  session_at_local?: unknown
  modality?: unknown
  duration_min?: unknown
  rpe?: unknown
  format?: unknown
  notes?: unknown
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

function stringOrNull(v: unknown, maxLen: number): string | null | 'invalid' {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return 'invalid'
  const trimmed = v.trim()
  if (trimmed === '') return null
  if (trimmed.length > maxLen) return 'invalid'
  return trimmed
}

export async function POST(request: NextRequest) {
  const auth = await resolveApiAuth(request)
  if (!auth) return jsonError(401, 'unauthorized')
  if (!auth.canWrite) return jsonError(403, 'token_read_only')

  let body: SessionPayload
  try {
    body = (await request.json()) as SessionPayload
  } catch {
    return jsonError(400, 'invalid_json')
  }

  const sessionAtLocal = body.session_at_local
  if (typeof sessionAtLocal !== 'string' || !isValidLocalIso(sessionAtLocal)) {
    return jsonError(
      400,
      'invalid_session_at_local',
      'expected YYYY-MM-DDTHH:MM (Amsterdam wall clock)',
    )
  }
  const padded =
    sessionAtLocal.length === 16 ? sessionAtLocal + ':00' : sessionAtLocal

  const modality = body.modality
  if (typeof modality !== 'string' || !VALID_MODALITIES.includes(modality as Modality)) {
    return jsonError(
      400,
      'invalid_modality',
      `expected one of: ${VALID_MODALITIES.join(', ')}`,
    )
  }

  const duration = intOrNull(body.duration_min, 1, 600)
  if (duration === 'invalid') {
    return jsonError(400, 'invalid_duration_min', 'expected integer 1-600')
  }
  const rpe = intOrNull(body.rpe, 1, 10)
  if (rpe === 'invalid') {
    return jsonError(400, 'invalid_rpe', 'expected integer 1-10')
  }
  const format = stringOrNull(body.format, 80)
  if (format === 'invalid') {
    return jsonError(400, 'invalid_format', 'max 80 chars')
  }
  const notes = stringOrNull(body.notes, 4000)
  if (notes === 'invalid') {
    return jsonError(400, 'invalid_notes', 'max 4000 chars')
  }

  let utcIso: string
  try {
    utcIso = amsterdamWallClockToUtcIso(padded)
  } catch {
    return jsonError(400, 'time_conversion_failed')
  }

  const admin = createSupabaseAdminClient()
  const { data: inserted, error } = await admin
    .from('training_sessions')
    .insert({
      user_id: auth.userId,
      session_at: utcIso,
      session_at_local: padded,
      timezone: 'Europe/Amsterdam',
      modality,
      duration_min: duration,
      rpe,
      format,
      notes,
    })
    .select('id, session_at, session_at_local, modality, duration_min, rpe')
    .single()

  if (error || !inserted) {
    return jsonError(500, 'insert_failed', error?.message)
  }

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json(
    { ok: true, session: inserted },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}
