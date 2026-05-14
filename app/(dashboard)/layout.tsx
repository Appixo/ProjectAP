import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'

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
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-neutral-200 px-6 py-3 flex items-center justify-between">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="font-semibold">Consistent</Link>
          <Link href="/log" className="text-neutral-600 hover:text-neutral-900">Log</Link>
          <Link href="/settings" className="text-neutral-600 hover:text-neutral-900">Settings</Link>
        </nav>
        <form action="/api/auth/signout" method="post" className="flex items-center gap-3">
          <span className="text-sm text-neutral-600">{user.email}</span>
          <button type="submit" className="text-sm text-neutral-600 hover:text-neutral-900 underline-offset-2 hover:underline">
            Sign out
          </button>
        </form>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
