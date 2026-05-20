import { NextResponse } from 'next/server'

// Auth is disabled — the dashboard is unauthenticated. Owner identity is
// resolved server-side from ALLOWED_EMAIL (see lib/auth/owner.ts). This
// proxy is a pass-through kept only to leave a single hook in place if we
// ever need request-level rewrites.
export function proxy() {
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
