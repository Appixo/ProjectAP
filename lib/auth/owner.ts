import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// Single-owner mode: the dashboard is unauthenticated. Every server-side
// read/write resolves the owner's user_id from ALLOWED_EMAIL via the admin
// client, then runs through the service-role client (bypassing RLS). Queries
// must still pass an explicit .eq('user_id', user.id) filter — without it,
// the admin client would return rows across all users.
//
// Fast path: if OWNER_USER_ID + ALLOWED_EMAIL are both in env, skip the
// listUsers() round-trip entirely. Saves ~200–500 ms per cold start
// (Supabase auth.admin.listUsers is a remote call, can be the slowest
// thing in a cold Lambda).

let cached: { id: string; email: string } | null = null

export async function requireOwner(): Promise<{
  supabase: ReturnType<typeof createSupabaseAdminClient>
  user: { id: string; email: string }
}> {
  const supabase = createSupabaseAdminClient()
  if (cached) return { supabase, user: cached }

  const email = process.env.ALLOWED_EMAIL
  if (!email) throw new Error('ALLOWED_EMAIL not set')

  const envOwnerId = process.env.OWNER_USER_ID
  if (envOwnerId) {
    cached = { id: envOwnerId, email }
    return { supabase, user: cached }
  }

  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) throw new Error(`failed to list users: ${error.message}`)

  const owner = data.users.find(
    u => u.email?.toLowerCase() === email.toLowerCase(),
  )
  if (!owner || !owner.email) {
    throw new Error(`no user found with email ${email}`)
  }

  cached = { id: owner.id, email: owner.email }
  return { supabase, user: cached }
}

export async function getOwnerUserId(): Promise<string> {
  const { user } = await requireOwner()
  return user.id
}
