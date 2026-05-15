'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

function LoginForm() {
  const params = useSearchParams()
  const next = params.get('next') ?? '/'
  const denied = params.get('denied') === '1'
  const callbackError = params.get('error')

  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const supabase = createSupabaseBrowserClient()
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      })
      if (error) {
        setError(error.message)
      } else {
        setSent(true)
      }
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="max-w-sm w-full text-center space-y-2">
        <h1 className="text-2xl font-semibold text-ink">Check your email</h1>
        <p className="text-sm text-muted">
          Sent a sign-in link to <span className="font-mono">{email}</span>.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm w-full space-y-4">
      <h1 className="text-2xl font-semibold text-ink">Sign in</h1>
      {denied && (
        <p className="text-sm text-warn">
          That email is not authorised for this app.
        </p>
      )}
      {callbackError && !denied && (
        <p className="text-sm text-warn">
          Sign-in link could not be verified. Request a new one.
        </p>
      )}
      <input
        type="email"
        required
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full rounded border border-border bg-panel text-ink px-3 py-2 outline-none focus:border-border-2"
      />
      {error && <p className="text-sm text-warn">{error}</p>}
      <button
        type="submit"
        disabled={loading || !email}
        className="w-full rounded bg-ink text-bg px-3 py-2 font-medium disabled:opacity-50 hover:opacity-90"
      >
        {loading ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  )
}
