import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  deleteActivityById,
  ensureFreshToken,
  fetchActivityById,
  getAccountByAthlete,
  upsertIfRun,
} from '@/lib/strava/sync'

interface StravaWebhookEvent {
  aspect_type: 'create' | 'update' | 'delete'
  event_time: number
  object_id: number
  object_type: 'activity' | 'athlete'
  owner_id: number
  subscription_id: number
  updates?: Record<string, string | boolean>
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const verifyToken = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN
  if (mode !== 'subscribe' || !expected || verifyToken !== expected || !challenge) {
    return NextResponse.json({ error: 'verify_failed' }, { status: 403 })
  }
  return NextResponse.json({ 'hub.challenge': challenge })
}

export async function POST(request: NextRequest) {
  let payload: StravaWebhookEvent
  try {
    payload = (await request.json()) as StravaWebhookEvent
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  const { data: inserted, error: insertError } = await admin
    .from('strava_webhook_events')
    .insert({ payload })
    .select('id')
    .single<{ id: number }>()

  if (insertError || !inserted) {
    // Even if we can't persist, ack to Strava so the event isn't retried into
    // a broken endpoint. The Strava dashboard will show the failure.
    return NextResponse.json({ received: true }, { status: 200 })
  }

  try {
    await processEvent(admin, payload)
    await admin
      .from('strava_webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', inserted.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await admin
      .from('strava_webhook_events')
      .update({ processing_error: msg.slice(0, 1000) })
      .eq('id', inserted.id)
  }

  return NextResponse.json({ received: true }, { status: 200 })
}

async function processEvent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  e: StravaWebhookEvent,
): Promise<void> {
  if (e.object_type === 'athlete') {
    if (e.updates?.authorized === 'false' || e.updates?.authorized === false) {
      await admin.from('strava_account').delete().eq('athlete_id', e.owner_id)
    }
    return
  }

  if (e.object_type !== 'activity') return

  const account = await getAccountByAthlete(admin, e.owner_id)
  if (!account) return

  if (e.aspect_type === 'delete') {
    await deleteActivityById(admin, account.user_id, e.object_id)
    return
  }

  // create / update — fetch detail and upsert if it's a Run
  const accessToken = await ensureFreshToken(admin, account)
  const activity = await fetchActivityById(accessToken, e.object_id)
  if (!activity) return
  await upsertIfRun(admin, account.user_id, activity)
}
