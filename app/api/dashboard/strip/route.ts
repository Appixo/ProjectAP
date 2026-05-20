import { NextResponse, type NextRequest } from 'next/server'
import { requireOwner } from '@/lib/auth/owner'
import { mondayOfYmd, addWeeks } from '@/lib/time/week'
import {
  buildStripData,
  type RawStripRun,
  type RawStripSession,
} from '@/lib/strip/build'

// Strip data for a single week. Called by the WeekStrip client component on
// prev/next/today nav, so the dashboard server tree doesn't re-execute on
// every navigation.
//
// Auth: owner-only (single-user app, auth is off — the cookie/origin model
// in proxy.ts already gates access at the edge). The endpoint resolves the
// owner via requireOwner() and scopes its queries by that user_id.
//
// Run classification is intentionally skipped here — see lib/strip/build.ts.
// The strip's dot colour falls back to 'easy' for everything; users care
// about the planned/actual badge and the popover content, not the dot hue,
// when scrubbing weeks.

export async function GET(request: NextRequest) {
  const { supabase, user } = await requireOwner()
  const url = new URL(request.url)
  const requested = url.searchParams.get('weekMonday')
  if (!requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    return NextResponse.json(
      { error: 'invalid_weekMonday', detail: 'expected YYYY-MM-DD' },
      { status: 400 },
    )
  }
  const monday = mondayOfYmd(requested)
  const startIso = new Date(monday + 'T00:00:00Z').toISOString()
  const endIso = new Date(addWeeks(monday, 1) + 'T00:00:00Z').toISOString()

  const [{ data: runs, error: runsError }, { data: sessions, error: sessionsError }] =
    await Promise.all([
      supabase
        .from('activities')
        .select('id, start_at, distance_m, moving_time_s, average_speed_mps')
        .eq('user_id', user.id)
        .eq('type', 'Run')
        .gte('start_at', startIso)
        .lt('start_at', endIso)
        .order('start_at', { ascending: true })
        .returns<RawStripRun[]>(),
      supabase
        .from('training_sessions')
        .select(
          'id, session_at, session_at_local, modality, duration_min, rpe, status, description, format, notes, matched_activity_id',
        )
        .eq('user_id', user.id)
        .gte('session_at', startIso)
        .lt('session_at', endIso)
        .order('session_at', { ascending: true })
        .returns<RawStripSession[]>(),
    ])

  if (runsError || sessionsError) {
    return NextResponse.json(
      {
        error: 'query_failed',
        detail: runsError?.message ?? sessionsError?.message,
      },
      { status: 500 },
    )
  }

  const strip = buildStripData(runs ?? [], sessions ?? [])
  return NextResponse.json(
    { monday, ...strip },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
