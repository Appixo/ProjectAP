import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveApiAuth, touchTokenLastUsed } from '@/lib/auth/api-auth'

// Controlled vocabulary for soreness.area. Matches the enum advertised in
// /api/export's context.schema.daily_logs.soreness. Free-text would let
// "calf" vs "calves" silently split a trend.
const SORENESS_AREAS = [
  'calves',
  'hamstrings',
  'quads',
  'glutes',
  'hip_flexors',
  'lower_back',
  'shins',
  'feet',
  'ankles',
  'knees',
  'achilles',
  'it_band',
  'other',
] as const

type SorenessArea = (typeof SORENESS_AREAS)[number]

interface SorenessEntry {
  area: SorenessArea
  score_1_5: number
}

interface DailyLogPayload {
  date?: unknown
  sleep_hours?: unknown
  sleep_quality_1_5?: unknown
  bedtime?: unknown
  wake_time?: unknown
  morning_rhr_bpm?: unknown
  hrv_ms?: unknown
  soreness?: unknown
  water_l?: unknown
  caffeine_mg?: unknown
  caffeine_last_at?: unknown
  alcohol_units?: unknown
  body_weight_kg?: unknown
  mood_1_5?: unknown
  stress_1_5?: unknown
  notes?: unknown
  // backwards-compatible legacy fields (still in the table)
  sleep_score?: unknown
  energy?: unknown
  habit_strength_done?: unknown
  habit_no_alcohol?: unknown
  habit_in_bed_on_time?: unknown
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

function isHm(s: unknown): s is string {
  return typeof s === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(s)
}

function isIsoTimestamp(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const d = new Date(s)
  return !isNaN(d.getTime())
}

// number-or-null, bounded. Returns 'invalid' on type/range failure,
// null on absent, otherwise the number. Accepts ints and floats; rejects
// NaN/Infinity. The caller decides whether the field is required.
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

function boolOrNull(v: unknown): boolean | null | 'invalid' {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v
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

// soreness: array of { area: <one of SORENESS_AREAS>, score_1_5: int 1-5 }.
function sorenessOrNull(
  v: unknown,
): SorenessEntry[] | null | 'invalid' {
  if (v === undefined || v === null) return null
  if (!Array.isArray(v)) return 'invalid'
  const out: SorenessEntry[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') return 'invalid'
    const area = (item as Record<string, unknown>).area
    const score = (item as Record<string, unknown>).score_1_5
    if (typeof area !== 'string') return 'invalid'
    const trimmed = area.trim().toLowerCase()
    if (!(SORENESS_AREAS as readonly string[]).includes(trimmed)) {
      return 'invalid'
    }
    const s = numOrNull(score, 1, 5, { integer: true })
    if (s === 'invalid' || s === null) return 'invalid'
    out.push({ area: trimmed as SorenessArea, score_1_5: s })
  }
  return out
}

export async function POST(request: NextRequest) {
  const auth = await resolveApiAuth(request)
  if (!auth) return jsonError(401, 'unauthorized')
  if (!auth.canWrite) return jsonError(403, 'token_read_only')

  let body: DailyLogPayload
  try {
    body = (await request.json()) as DailyLogPayload
  } catch {
    return jsonError(400, 'invalid_json')
  }

  if (!isYmd(body.date)) {
    return jsonError(400, 'invalid_date', 'expected YYYY-MM-DD')
  }
  const logDate = body.date

  // Validate every field. Each parser returns one of: value | null | 'invalid'.
  const sleepHours = numOrNull(body.sleep_hours, 0, 24)
  const sleepQuality = numOrNull(body.sleep_quality_1_5, 1, 5, { integer: true })
  const bedtime = body.bedtime === undefined || body.bedtime === null || body.bedtime === ''
    ? null
    : isHm(body.bedtime)
    ? (body.bedtime as string)
    : 'invalid'
  const wakeTime = body.wake_time === undefined || body.wake_time === null || body.wake_time === ''
    ? null
    : isHm(body.wake_time)
    ? (body.wake_time as string)
    : 'invalid'
  const morningRhr = numOrNull(body.morning_rhr_bpm, 20, 200, { integer: true })
  const hrv = numOrNull(body.hrv_ms, 1, 500, { integer: true })
  const soreness = sorenessOrNull(body.soreness)
  const waterL = numOrNull(body.water_l, 0, 20)
  const caffeineMg = numOrNull(body.caffeine_mg, 0, 2000, { integer: true })
  const caffeineLastAt = body.caffeine_last_at === undefined || body.caffeine_last_at === null || body.caffeine_last_at === ''
    ? null
    : isIsoTimestamp(body.caffeine_last_at)
    ? new Date(body.caffeine_last_at as string).toISOString()
    : 'invalid'
  const alcoholUnits = numOrNull(body.alcohol_units, 0, 50)
  const bodyWeightKg = numOrNull(body.body_weight_kg, 20.001, 249.999)
  const mood = numOrNull(body.mood_1_5, 1, 5, { integer: true })
  const stress = numOrNull(body.stress_1_5, 1, 5, { integer: true })
  const notes = stringOrNull(body.notes, 4000)
  // legacy columns kept for compatibility with the existing /log UI
  const sleepScore = numOrNull(body.sleep_score, 0, 100, { integer: true })
  const energy = numOrNull(body.energy, 1, 5, { integer: true })
  const habitStrength = boolOrNull(body.habit_strength_done)
  const habitNoAlcohol = boolOrNull(body.habit_no_alcohol)
  const habitInBedOnTime = boolOrNull(body.habit_in_bed_on_time)

  // Collect first invalid field so the caller knows which one failed.
  const checks: Array<[string, unknown]> = [
    ['sleep_hours', sleepHours],
    ['sleep_quality_1_5', sleepQuality],
    ['bedtime', bedtime],
    ['wake_time', wakeTime],
    ['morning_rhr_bpm', morningRhr],
    ['hrv_ms', hrv],
    ['soreness', soreness],
    ['water_l', waterL],
    ['caffeine_mg', caffeineMg],
    ['caffeine_last_at', caffeineLastAt],
    ['alcohol_units', alcoholUnits],
    ['body_weight_kg', bodyWeightKg],
    ['mood_1_5', mood],
    ['stress_1_5', stress],
    ['notes', notes],
    ['sleep_score', sleepScore],
    ['energy', energy],
    ['habit_strength_done', habitStrength],
    ['habit_no_alcohol', habitNoAlcohol],
    ['habit_in_bed_on_time', habitInBedOnTime],
  ]
  for (const [field, value] of checks) {
    if (value === 'invalid') {
      return jsonError(400, `invalid_${field}`)
    }
  }

  // Build an upsert payload that ONLY includes provided fields, so a partial
  // update (e.g. just morning_rhr_bpm) doesn't blank out the existing row.
  const row: Record<string, unknown> = {
    user_id: auth.userId,
    log_date: logDate,
    source: 'logged',
    updated_at: new Date().toISOString(),
  }
  const maybeSet = (key: string, value: unknown) => {
    if (value !== null && value !== undefined) row[key] = value
  }
  // Booleans default to false in the DB; only set when explicitly provided.
  // Numerics/strings: only set when non-null.
  maybeSet('sleep_hours', sleepHours)
  maybeSet('sleep_quality_1_5', sleepQuality)
  maybeSet('bedtime', bedtime)
  maybeSet('wake_time', wakeTime)
  maybeSet('morning_rhr_bpm', morningRhr)
  maybeSet('hrv_ms', hrv)
  maybeSet('soreness', soreness)
  maybeSet('water_l', waterL)
  maybeSet('caffeine_mg', caffeineMg)
  maybeSet('caffeine_last_at', caffeineLastAt)
  maybeSet('alcohol_units', alcoholUnits)
  maybeSet('body_weight_kg', bodyWeightKg)
  maybeSet('mood_1_5', mood)
  maybeSet('stress_1_5', stress)
  maybeSet('notes', notes)
  maybeSet('sleep_score', sleepScore)
  maybeSet('energy', energy)
  maybeSet('habit_strength_done', habitStrength)
  maybeSet('habit_no_alcohol', habitNoAlcohol)
  maybeSet('habit_in_bed_on_time', habitInBedOnTime)

  const admin = createSupabaseAdminClient()
  const { data: inserted, error } = await admin
    .from('daily_log')
    .upsert(row, { onConflict: 'user_id,log_date' })
    .select(
      'log_date, sleep_hours, sleep_quality_1_5, bedtime, wake_time, ' +
        'morning_rhr_bpm, hrv_ms, soreness, water_l, caffeine_mg, ' +
        'caffeine_last_at, alcohol_units, body_weight_kg, mood_1_5, ' +
        'stress_1_5, notes, sleep_score, energy, habit_strength_done, ' +
        'habit_no_alcohol, habit_in_bed_on_time, source, updated_at',
    )
    .single()

  if (error || !inserted) {
    return jsonError(500, 'upsert_failed', error?.message)
  }

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json(
    { ok: true, daily_log: inserted },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
