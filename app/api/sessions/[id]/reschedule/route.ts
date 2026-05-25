import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireOwner } from '@/lib/auth/owner'
import {
  addDays,
  amsterdamWallClockToUtcIso,
  todayInAmsterdam,
} from '@/lib/time/week'

// Actions for a planned session:
//   - action='complete'       → mark it status='completed'. One-tap "I did
//                               this" with no duration/notes required — keeps
//                               friction near zero for strength/football days.
//   - action='skip'           → mark it status='skipped'; no date change.
//   - action='next_rest_day'  → find the next day in the next 14 days with no
//                               other (non-skipped) session, move this row to
//                               that day keeping its original time-of-day,
//                               keep status='planned'.
//
// "Rest day" here means a day with zero scheduled rows — that's stricter than
// the user's mental model (Mon/Sat are usually rest), but it matches what
// the DB actually shows. The generator omits rest days from training_sessions,
// so any day without rows is fair game.

interface RescheduleBody {
  action?: unknown
}

interface SessionRow {
  id: string
  session_at_local: string
  status: string | null
}

const SEARCH_DAYS = 14

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { user } = await requireOwner()
  const admin = createSupabaseAdminClient()

  let body: RescheduleBody
  try {
    body = (await request.json()) as RescheduleBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const action = body.action
  if (action !== 'next_rest_day' && action !== 'skip' && action !== 'complete') {
    return NextResponse.json(
      {
        error: 'invalid_action',
        detail: "expected 'next_rest_day', 'skip', or 'complete'",
      },
      { status: 400 },
    )
  }

  const { data: session, error: fetchError } = await admin
    .from('training_sessions')
    .select('id, session_at_local, status')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle<SessionRow>()

  if (fetchError) {
    return NextResponse.json(
      { error: 'fetch_failed', detail: fetchError.message },
      { status: 500 },
    )
  }
  if (!session) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (action === 'skip' || action === 'complete') {
    const newStatus = action === 'skip' ? 'skipped' : 'completed'
    const { error } = await admin
      .from('training_sessions')
      .update({ status: newStatus })
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) {
      return NextResponse.json(
        { error: 'update_failed', detail: error.message },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true, action })
  }

  // next_rest_day: find the next day in the next 14 days with no
  // non-skipped session.
  const today = todayInAmsterdam()
  const earliest = addDays(today, 1) // never reschedule to today

  const { data: occupied, error: occupiedError } = await admin
    .from('training_sessions')
    .select('session_at_local, status')
    .eq('user_id', user.id)
    .gte('session_at_local', earliest + 'T00:00:00')
    .lt('session_at_local', addDays(earliest, SEARCH_DAYS) + 'T00:00:00')
    .neq('id', id)
    .returns<{ session_at_local: string; status: string | null }[]>()

  if (occupiedError) {
    return NextResponse.json(
      { error: 'query_failed', detail: occupiedError.message },
      { status: 500 },
    )
  }

  const occupiedDates = new Set(
    (occupied ?? [])
      .filter(s => s.status !== 'skipped')
      .map(s => s.session_at_local.slice(0, 10)),
  )

  let newDate: string | null = null
  for (let i = 0; i < SEARCH_DAYS; i++) {
    const candidate = addDays(earliest, i)
    if (!occupiedDates.has(candidate)) {
      newDate = candidate
      break
    }
  }

  if (!newDate) {
    return NextResponse.json(
      {
        error: 'no_free_day',
        detail: 'every day in the next 14 has a session — skip instead',
      },
      { status: 409 },
    )
  }

  // Keep the original time-of-day. session_at_local is YYYY-MM-DDTHH:MM:SS
  // or YYYY-MM-DDTHH:MM. Slice from char 10 onward to get the T-prefixed
  // time portion.
  const timeSuffix = session.session_at_local.slice(10)
  const newLocal = newDate + timeSuffix
  let newUtc: string
  try {
    newUtc = amsterdamWallClockToUtcIso(newLocal)
  } catch {
    return NextResponse.json({ error: 'time_conversion_failed' }, { status: 500 })
  }

  const { error: updateError } = await admin
    .from('training_sessions')
    .update({
      session_at: newUtc,
      session_at_local: newLocal,
      status: 'planned',
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (updateError) {
    return NextResponse.json(
      { error: 'update_failed', detail: updateError.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, action: 'next_rest_day', newDate })
}
