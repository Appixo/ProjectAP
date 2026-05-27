import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveApiAuth, touchTokenLastUsed } from '@/lib/auth/api-auth'
import {
  VALID_MODALITIES,
  type Modality,
} from '@/lib/sessions/validate'

// GET /api/sessions/last?modality=strength_lower
//
// Returns the most recent prior session of the given modality (any status —
// planned, completed, or skipped all count). Owner-scoped. Feeds the
// "Repeat last" action on the log form, which pre-fills format, duration_min,
// and description.exercises from the returned row as editable starting values.
//
// 404 when there's no prior session of that modality — the caller treats
// that as "first time logging this; start with an empty form."
//
// Note on `session_at < now()`: we filter by the row's UTC timestamp so a
// session scheduled later today doesn't get returned as the "last" one when
// the user is logging an actual workout in the morning.

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json(
    detail ? { error, detail } : { error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

const SELECT_COLS =
  'id, session_at, session_at_local, timezone, modality, duration_min, ' +
  'rpe, format, notes, status, description, source'

export async function GET(request: NextRequest) {
  const auth = await resolveApiAuth(request)
  if (!auth) return jsonError(401, 'unauthorized')

  const url = new URL(request.url)
  const modality = url.searchParams.get('modality')
  if (!modality || !VALID_MODALITIES.includes(modality as Modality)) {
    return jsonError(
      400,
      'invalid_modality',
      `expected one of: ${VALID_MODALITIES.join(', ')}`,
    )
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('training_sessions')
    .select(SELECT_COLS)
    .eq('user_id', auth.userId)
    .eq('modality', modality)
    .lt('session_at', new Date().toISOString())
    .order('session_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return jsonError(500, 'query_failed', error.message)
  }
  if (!data) {
    return jsonError(404, 'not_found', `no prior ${modality} session`)
  }

  if (auth.source === 'token' && auth.rawToken) {
    await touchTokenLastUsed(auth.rawToken)
  }

  return NextResponse.json(
    { ok: true, session: data },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
