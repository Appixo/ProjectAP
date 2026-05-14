// Server-side only; called from route handlers and local scripts.
// Not guarded with `server-only` because the local backfill script
// imports it directly under tsx. Strava secrets here are not prefixed
// with NEXT_PUBLIC_, so Next still won't inline them into the client bundle.

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'

interface StravaTokenBase {
  token_type: string
  expires_at: number
  expires_in: number
  refresh_token: string
  access_token: string
}

export interface StravaAuthorizeResponse extends StravaTokenBase {
  athlete: {
    id: number
    firstname?: string
    lastname?: string
    username?: string | null
  }
}

export type StravaRefreshResponse = StravaTokenBase

export async function exchangeCodeForToken(
  code: string,
): Promise<StravaAuthorizeResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      client_secret: process.env.STRAVA_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(
      `Strava token exchange failed: ${res.status} ${await res.text()}`,
    )
  }
  return res.json() as Promise<StravaAuthorizeResponse>
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<StravaRefreshResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      client_secret: process.env.STRAVA_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(
      `Strava token refresh failed: ${res.status} ${await res.text()}`,
    )
  }
  return res.json() as Promise<StravaRefreshResponse>
}
