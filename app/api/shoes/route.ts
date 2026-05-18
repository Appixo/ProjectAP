import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveApiAuth, touchTokenLastUsed } from '@/lib/auth/api-auth'

const HIGH_KM_FLAG = 600

interface ShoeRow {
  id: string
  brand: string | null
  model: string | null
  purchase_date: string | null
  retire_at_km: number
  retired_at: string | null
  created_at: string
  updated_at: string
}

interface ShoePayload {
  brand?: unknown
  model?: unknown
  purchase_date?: unknown
  retire_at_km?: unknown
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
  const [{ data: shoes, error: shoesErr }, { data: shoedRuns, error: kmErr }] =
    await Promise.all([
      admin
        .from('shoes')
        .select(
          'id, brand, model, purchase_date, retire_at_km, retired_at, created_at, updated_at',
        )
        .eq('user_id', auth.userId)
        .order('created_at', { ascending: false })
        .returns<ShoeRow[]>(),
      admin
        .from('activities')
        .select('shoe_id, distance_m')
        .eq('user_id', auth.userId)
        .not('shoe_id', 'is', null)
        .returns<{ shoe_id: string; distance_m: number }[]>(),
    ])

  if (shoesErr) return jsonError(500, 'query_failed', shoesErr.message)
  if (kmErr) return jsonError(500, 'query_failed', kmErr.message)

  const metersByShoe = new Map<string, number>()
  for (const r of shoedRuns ?? []) {
    if (!r.shoe_id) continue
    metersByShoe.set(r.shoe_id, (metersByShoe.get(r.shoe_id) ?? 0) + (r.distance_m ?? 0))
  }
  const kmByShoe = new Map<string, number>()
  for (const [id, meters] of metersByShoe) {
    kmByShoe.set(id, Number((meters / 1000).toFixed(2)))
  }

  const enriched = (shoes ?? []).map(s => {
    const currentKm = kmByShoe.get(s.id) ?? 0
    return {
      ...s,
      current_km: currentKm,
      over_threshold_km: currentKm > HIGH_KM_FLAG,
      over_retire_km: currentKm > s.retire_at_km,
    }
  })

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json(
    { shoes: enriched },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: NextRequest) {
  const auth = await resolveApiAuth(request)
  if (!auth) return jsonError(401, 'unauthorized')
  if (!auth.canWrite) return jsonError(403, 'token_read_only')

  let body: ShoePayload
  try {
    body = (await request.json()) as ShoePayload
  } catch {
    return jsonError(400, 'invalid_json')
  }

  const brand = stringOrNull(body.brand, 60)
  if (brand === 'invalid') return jsonError(400, 'invalid_brand', 'max 60 chars')
  const model = stringOrNull(body.model, 80)
  if (model === 'invalid') return jsonError(400, 'invalid_model', 'max 80 chars')

  let purchaseDate: string | null = null
  if (body.purchase_date !== undefined && body.purchase_date !== null && body.purchase_date !== '') {
    if (!isYmd(body.purchase_date)) {
      return jsonError(400, 'invalid_purchase_date', 'expected YYYY-MM-DD')
    }
    purchaseDate = body.purchase_date
  }

  let retireAtKm: number | undefined
  if (body.retire_at_km !== undefined && body.retire_at_km !== null && body.retire_at_km !== '') {
    const n = typeof body.retire_at_km === 'number'
      ? body.retire_at_km
      : Number(body.retire_at_km)
    if (!Number.isFinite(n) || n <= 0 || n > 5000) {
      return jsonError(400, 'invalid_retire_at_km', 'expected number 1-5000')
    }
    retireAtKm = n
  }

  if (brand === null && model === null) {
    return jsonError(400, 'missing_fields', 'at least one of brand or model required')
  }

  const admin = createSupabaseAdminClient()
  const row: Record<string, unknown> = {
    user_id: auth.userId,
    brand,
    model,
    purchase_date: purchaseDate,
  }
  if (retireAtKm !== undefined) row.retire_at_km = retireAtKm

  const { data: inserted, error } = await admin
    .from('shoes')
    .insert(row)
    .select(
      'id, brand, model, purchase_date, retire_at_km, retired_at, created_at, updated_at',
    )
    .single()

  if (error || !inserted) {
    return jsonError(500, 'insert_failed', error?.message)
  }

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json(
    {
      ok: true,
      shoe: { ...inserted, current_km: 0, over_threshold_km: false, over_retire_km: false },
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}
