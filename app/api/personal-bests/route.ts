import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveApiAuth, touchTokenLastUsed } from '@/lib/auth/api-auth'

interface PbPayload {
  distance_m?: unknown
  time_s?: unknown
  achieved_at?: unknown
  event_name?: unknown
  activity_id?: unknown
  notes?: unknown
}

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json(
    detail ? { error, detail } : { error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function numOrNull(
  v: unknown,
  lo: number,
  hi: number,
  opts: { integer?: boolean } = {},
): number | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') n = Number(v)
  else return 'invalid'
  if (!Number.isFinite(n)) return 'invalid'
  if (opts.integer && !Number.isInteger(n)) return 'invalid'
  if (n < lo || n > hi) return 'invalid'
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

export async function GET(request: NextRequest) {
  const auth = await resolveApiAuth(request)
  if (!auth) return jsonError(401, 'unauthorized')

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('personal_bests')
    .select(
      'id, distance_m, time_s, achieved_at, event_name, activity_id, source, notes, created_at, updated_at',
    )
    .eq('user_id', auth.userId)
    .order('distance_m', { ascending: true })
    .order('time_s', { ascending: true })

  if (error) return jsonError(500, 'query_failed', error.message)

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json(
    { personal_bests: data ?? [] },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: NextRequest) {
  const auth = await resolveApiAuth(request)
  if (!auth) return jsonError(401, 'unauthorized')
  if (!auth.canWrite) return jsonError(403, 'token_read_only')

  let body: PbPayload
  try {
    body = (await request.json()) as PbPayload
  } catch {
    return jsonError(400, 'invalid_json')
  }

  const distance = numOrNull(body.distance_m, 100, 200_000)
  if (distance === 'invalid' || distance === null) {
    return jsonError(400, 'invalid_distance_m', 'expected number 100-200000 (meters)')
  }
  const time = numOrNull(body.time_s, 1, 100_000, { integer: true })
  if (time === 'invalid' || time === null) {
    return jsonError(400, 'invalid_time_s', 'expected integer 1-100000 (seconds)')
  }
  if (!isYmd(body.achieved_at)) {
    return jsonError(400, 'invalid_achieved_at', 'expected YYYY-MM-DD')
  }
  const eventName = stringOrNull(body.event_name, 120)
  if (eventName === 'invalid') return jsonError(400, 'invalid_event_name', 'max 120 chars')
  const notes = stringOrNull(body.notes, 2000)
  if (notes === 'invalid') return jsonError(400, 'invalid_notes', 'max 2000 chars')

  // activity_id is optional; null means "not linked to a logged Strava run".
  let activityId: number | null = null
  if (body.activity_id !== undefined && body.activity_id !== null && body.activity_id !== '') {
    const a = numOrNull(body.activity_id, 1, Number.MAX_SAFE_INTEGER, { integer: true })
    if (a === 'invalid') return jsonError(400, 'invalid_activity_id')
    activityId = a as number
  }

  const admin = createSupabaseAdminClient()
  const { data: inserted, error } = await admin
    .from('personal_bests')
    .insert({
      user_id: auth.userId,
      distance_m: distance,
      time_s: time,
      achieved_at: body.achieved_at,
      event_name: eventName,
      activity_id: activityId,
      notes,
      source: 'logged',
    })
    .select(
      'id, distance_m, time_s, achieved_at, event_name, activity_id, source, notes',
    )
    .single()

  if (error || !inserted) {
    return jsonError(500, 'insert_failed', error?.message)
  }

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json(
    { ok: true, personal_best: inserted },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function DELETE(request: NextRequest) {
  const auth = await resolveApiAuth(request)
  if (!auth) return jsonError(401, 'unauthorized')
  if (!auth.canWrite) return jsonError(403, 'token_read_only')

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) return jsonError(400, 'missing_id')

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('personal_bests')
    .delete()
    .eq('user_id', auth.userId)
    .eq('id', id)
  if (error) return jsonError(500, 'delete_failed', error.message)

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
