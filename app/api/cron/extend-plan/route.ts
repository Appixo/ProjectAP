import { NextResponse, type NextRequest } from 'next/server'
import { extendPlanForOwner } from '@/lib/plan/extend'

// Vercel Cron (see vercel.json) calls this weekly with the standard
// Authorization: Bearer <CRON_SECRET> header. Same code path also runs from
// the "Seed next 4 weeks" button in /settings/plan via the lib function.

function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const got = request.headers.get('authorization')
  return got === `Bearer ${expected}`
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const result = await extendPlanForOwner()
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: 'extend_failed', detail: message }, { status: 500 })
  }
}
