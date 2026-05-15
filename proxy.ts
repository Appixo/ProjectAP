import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { isAllowedEmail } from '@/lib/auth/allowlist'

const PUBLIC_PATHS = [
  '/login',
  '/auth/callback',
  '/api/strava/webhook',
  '/api/export',
  '/api/sessions',
]

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'))
}

function redirectWithCookies(
  url: URL,
  source: NextResponse,
): NextResponse {
  const redirect = NextResponse.redirect(url)
  for (const cookie of source.cookies.getAll()) {
    redirect.cookies.set(cookie)
  }
  return redirect
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname

  if (user && !isAllowedEmail(user.email)) {
    await supabase.auth.signOut()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('denied', '1')
    return redirectWithCookies(url, response)
  }

  if (!user && !isPublic(path)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    if (path !== '/') url.searchParams.set('next', path)
    return redirectWithCookies(url, response)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
