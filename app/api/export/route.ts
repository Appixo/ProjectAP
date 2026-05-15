import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { todayInAmsterdam } from '@/lib/time/week'

function notFound() {
  return new NextResponse('Not found', { status: 404 })
}

interface GoalsRow {
  primary_goal: string
  primary_event_date: string | null
  secondary_goal: string | null
  secondary_event_date: string | null
  secondary_kind: string | null
  notes: string | null
  updated_at: string
}

function daysBetween(fromYmd: string, toYmd: string | null): number | null {
  if (!toYmd) return null
  const [fy, fm, fd] = fromYmd.split('-').map(Number)
  const [ty, tm, td] = toYmd.split('-').map(Number)
  const fromMs = Date.UTC(fy, fm - 1, fd)
  const toMs = Date.UTC(ty, tm - 1, td)
  return Math.round((toMs - fromMs) / 86400000)
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const raw = url.searchParams.get('token')
  if (!raw) return notFound()

  const hash = createHash('sha256').update(raw).digest('hex')
  const admin = createSupabaseAdminClient()

  const { data: tokenRow } = await admin
    .from('export_tokens')
    .select('user_id, revoked, can_write')
    .eq('token_hash', hash)
    .maybeSingle<{ user_id: string; revoked: boolean; can_write: boolean }>()

  if (!tokenRow || tokenRow.revoked) return notFound()

  await admin
    .from('export_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', hash)

  const [
    { data: activities },
    { data: dailyLogs },
    { data: trainingSessions },
    { data: goalsRow },
    { data: user },
  ] = await Promise.all([
    admin
      .from('activities')
      .select(
        'id, start_at, start_at_local, timezone, name, type, distance_m, ' +
          'moving_time_s, elapsed_time_s, total_elevation_gain_m, ' +
          'average_heartrate, max_heartrate, average_speed_mps, max_speed_mps, ' +
          'has_heartrate',
      )
      .eq('user_id', tokenRow.user_id)
      .order('start_at', { ascending: false }),
    admin
      .from('daily_log')
      .select(
        'log_date, sleep_hours, sleep_score, energy, ' +
          'habit_strength_done, habit_no_alcohol, habit_in_bed_on_time, notes',
      )
      .eq('user_id', tokenRow.user_id)
      .order('log_date', { ascending: false }),
    admin
      .from('training_sessions')
      .select(
        'id, session_at, session_at_local, timezone, modality, ' +
          'duration_min, rpe, format, notes',
      )
      .eq('user_id', tokenRow.user_id)
      .order('session_at', { ascending: false }),
    admin
      .from('goals')
      .select(
        'primary_goal, primary_event_date, secondary_goal, ' +
          'secondary_event_date, secondary_kind, notes, updated_at',
      )
      .eq('user_id', tokenRow.user_id)
      .maybeSingle<GoalsRow>(),
    admin.auth.admin.getUserById(tokenRow.user_id),
  ])

  const today = todayInAmsterdam()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin
  const writeUrl = tokenRow.can_write
    ? `${appUrl}/api/sessions?token=${raw}`
    : null

  const context = {
    today,
    timezone: 'Europe/Amsterdam',
    week_starts: 'Monday',
    units: { distance: 'meters', pace: 'm/s', duration: 'seconds' },
    goals: goalsRow
      ? {
          primary_goal: goalsRow.primary_goal,
          primary_event_date: goalsRow.primary_event_date,
          days_to_primary_event: daysBetween(today, goalsRow.primary_event_date),
          secondary_goal: goalsRow.secondary_goal,
          secondary_event_date: goalsRow.secondary_event_date,
          secondary_kind: goalsRow.secondary_kind,
          days_to_secondary_event: daysBetween(
            today,
            goalsRow.secondary_event_date,
          ),
          notes: goalsRow.notes,
          updated_at: goalsRow.updated_at,
        }
      : null,
    token_scope: tokenRow.can_write ? 'read+write' : 'read',
    write_endpoints: {
      sessions: {
        url: writeUrl,
        url_pattern: `${appUrl}/api/sessions?token=<WRITE_TOKEN>`,
        method: 'POST',
        content_type: 'application/json',
        body_schema: {
          session_at_local:
            'string, YYYY-MM-DDTHH:MM in Europe/Amsterdam local time (required)',
          modality:
            'string, one of: strength_upper, strength_lower, football, mobility, other (required)',
          duration_min: 'integer 1-600 (optional)',
          rpe: 'integer 1-10 (optional)',
          format: 'string up to 80 chars (optional)',
          notes: 'string up to 4000 chars (optional)',
        },
        example_body: {
          session_at_local: `${today}T18:30`,
          modality: 'football',
          duration_min: 50,
          rpe: 7,
          format: '6v6 2x25min',
          notes: 'Felt sharp in first half.',
        },
        notes: tokenRow.can_write
          ? 'This token has write scope. POST to the url above to add a training session.'
          : 'This token is read-only. Ask the dashboard owner for a token with write scope to add sessions.',
      },
    },
  }

  return NextResponse.json(
    {
      generated_at: new Date().toISOString(),
      user: { email: user?.user?.email ?? null },
      context,
      activities: activities ?? [],
      training_sessions: trainingSessions ?? [],
      daily_logs: dailyLogs ?? [],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
