import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/auth/allowlist'

export interface ApiAuth {
  userId: string
  canWrite: boolean
  source: 'token' | 'session'
  rawToken: string | null
}

// Resolve API auth from EITHER a ?token= query param OR the Supabase session
// cookie. Returns null when neither resolves to an allowed user.
//
// Token path: matches export_tokens by sha256(raw). can_write read from row.
// Session path: requires a logged-in user whose email passes the allowlist.
// can_write is implicitly true (the user is themselves, no scope to narrow).
export async function resolveApiAuth(
  request: NextRequest,
): Promise<ApiAuth | null> {
  const url = new URL(request.url)
  const raw = url.searchParams.get('token')

  if (raw) {
    const hash = createHash('sha256').update(raw).digest('hex')
    const admin = createSupabaseAdminClient()
    const { data } = await admin
      .from('export_tokens')
      .select('user_id, revoked, can_write')
      .eq('token_hash', hash)
      .maybeSingle<{
        user_id: string
        revoked: boolean
        can_write: boolean
      }>()
    if (!data || data.revoked) return null
    return {
      userId: data.user_id,
      canWrite: data.can_write,
      source: 'token',
      rawToken: raw,
    }
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) return null
  return {
    userId: user.id,
    canWrite: true,
    source: 'session',
    rawToken: null,
  }
}

export async function touchTokenLastUsed(rawToken: string): Promise<void> {
  const hash = createHash('sha256').update(rawToken).digest('hex')
  const admin = createSupabaseAdminClient()
  await admin
    .from('export_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', hash)
}
