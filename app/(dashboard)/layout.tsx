import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ThemeToggle } from '@/components/ThemeToggle'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <header className="border-b border-border bg-panel px-6 py-2.5 flex items-center justify-between">
        <nav className="flex items-center gap-4 text-[13px]">
          <Link href="/" className="font-semibold text-ink">Consistent</Link>
          <Link href="/log" className="text-ink-2 hover:text-ink">Log</Link>
          <Link href="/settings" className="text-ink-2 hover:text-ink">Settings</Link>
        </nav>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <form action="/api/auth/signout" method="post" className="flex items-center gap-3">
            <span className="text-[12px] text-muted">{user.email}</span>
            <button
              type="submit"
              className="text-[12px] text-muted hover:text-ink underline-offset-2 hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
