import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveApiAuth, touchTokenLastUsed } from '@/lib/auth/api-auth'

const VALID_TEST_TYPES = [
  'max_hr_test',
  'lthr_test',
  'vo2_test',
  'race_5k',
  'race_10k',
  'race_half',
  'race_full',
  'other',
] as const
type TestType = (typeof VALID_TEST_TYPES)[number]

interface BenchmarkPayload {
  performed_at?: unknown
  test_type?: unknown
  max_hr_bpm?: unknown
  lthr_bpm?: unknown
  vo2max_ml_per_kg_min?: unknown
  pace_at_threshold_s_per_km?: unknown
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
    .from('benchmarks')
    .select(
      'id, performed_at, test_type, max_hr_bpm, lthr_bpm, vo2max_ml_per_kg_min, pace_at_threshold_s_per_km, activity_id, notes, created_at, updated_at',
    )
    .eq('user_id', auth.userId)
    .order('performed_at', { ascending: false })

  if (error) return jsonError(500, 'query_failed', error.message)

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json(
    { benchmarks: data ?? [] },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: NextRequest) {
  const auth = await resolveApiAuth(request)
  if (!auth) return jsonError(401, 'unauthorized')
  if (!auth.canWrite) return jsonError(403, 'token_read_only')

  let body: BenchmarkPayload
  try {
    body = (await request.json()) as BenchmarkPayload
  } catch {
    return jsonError(400, 'invalid_json')
  }

  if (!isYmd(body.performed_at)) {
    return jsonError(400, 'invalid_performed_at', 'expected YYYY-MM-DD')
  }
  if (
    typeof body.test_type !== 'string' ||
    !VALID_TEST_TYPES.includes(body.test_type as TestType)
  ) {
    return jsonError(
      400,
      'invalid_test_type',
      `expected one of: ${VALID_TEST_TYPES.join(', ')}`,
    )
  }

  const maxHr = numOrNull(body.max_hr_bpm, 100, 220, { integer: true })
  if (maxHr === 'invalid') return jsonError(400, 'invalid_max_hr_bpm', '100-220')
  const lthr = numOrNull(body.lthr_bpm, 100, 220, { integer: true })
  if (lthr === 'invalid') return jsonError(400, 'invalid_lthr_bpm', '100-220')
  const vo2 = numOrNull(body.vo2max_ml_per_kg_min, 20, 90)
  if (vo2 === 'invalid') return jsonError(400, 'invalid_vo2max', '20-90')
  const pace = numOrNull(body.pace_at_threshold_s_per_km, 120, 900, { integer: true })
  if (pace === 'invalid') return jsonError(400, 'invalid_pace', '120-900')
  const notes = stringOrNull(body.notes, 2000)
  if (notes === 'invalid') return jsonError(400, 'invalid_notes', 'max 2000 chars')

  let activityId: number | null = null
  if (body.activity_id !== undefined && body.activity_id !== null && body.activity_id !== '') {
    const a = numOrNull(body.activity_id, 1, Number.MAX_SAFE_INTEGER, { integer: true })
    if (a === 'invalid') return jsonError(400, 'invalid_activity_id')
    activityId = a as number
  }

  // Require at least one measurement so empty rows don't sneak in.
  if (maxHr === null && lthr === null && vo2 === null && pace === null) {
    return jsonError(
      400,
      'missing_measurement',
      'at least one of max_hr_bpm, lthr_bpm, vo2max_ml_per_kg_min, pace_at_threshold_s_per_km required',
    )
  }

  const admin = createSupabaseAdminClient()
  const { data: inserted, error } = await admin
    .from('benchmarks')
    .insert({
      user_id: auth.userId,
      performed_at: body.performed_at,
      test_type: body.test_type,
      max_hr_bpm: maxHr,
      lthr_bpm: lthr,
      vo2max_ml_per_kg_min: vo2,
      pace_at_threshold_s_per_km: pace,
      activity_id: activityId,
      notes,
    })
    .select(
      'id, performed_at, test_type, max_hr_bpm, lthr_bpm, vo2max_ml_per_kg_min, pace_at_threshold_s_per_km, activity_id, notes',
    )
    .single()

  if (error || !inserted) {
    return jsonError(500, 'insert_failed', error?.message)
  }

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json(
    { ok: true, benchmark: inserted },
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
    .from('benchmarks')
    .delete()
    .eq('user_id', auth.userId)
    .eq('id', id)
  if (error) return jsonError(500, 'delete_failed', error.message)

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
