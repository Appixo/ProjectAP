import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/auth/allowlist'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/'

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url))
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(new URL('/login?error=callback', request.url))
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!isAllowedEmail(user?.email)) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?denied=1', request.url))
  }

  return NextResponse.redirect(new URL(next, request.url))
}
