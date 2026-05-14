import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

function notFound() {
  return new NextResponse('Not found', { status: 404 })
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const raw = url.searchParams.get('token')
  if (!raw) return notFound()

  const hash = createHash('sha256').update(raw).digest('hex')
  const admin = createSupabaseAdminClient()

  const { data: tokenRow } = await admin
    .from('export_tokens')
    .select('user_id, revoked')
    .eq('token_hash', hash)
    .maybeSingle()

  if (!tokenRow || tokenRow.revoked) return notFound()

  await admin
    .from('export_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', hash)

  const [{ data: activities }, { data: dailyLogs }, { data: user }] =
    await Promise.all([
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
      admin.auth.admin.getUserById(tokenRow.user_id),
    ])

  return NextResponse.json(
    {
      generated_at: new Date().toISOString(),
      user: { email: user?.user?.email ?? null },
      activities: activities ?? [],
      daily_logs: dailyLogs ?? [],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
