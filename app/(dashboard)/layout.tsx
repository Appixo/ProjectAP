import Link from 'next/link'
import { ThemeToggle } from '@/components/ThemeToggle'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <header className="border-b border-border bg-panel px-6 py-2.5 flex items-center justify-between">
        <nav className="flex items-center gap-4 text-[13px]">
          <Link href="/" className="font-semibold text-ink">Consistent</Link>
          <Link href="/log" className="text-ink-2 hover:text-ink">Log</Link>
          <Link href="/settings" className="text-ink-2 hover:text-ink">Settings</Link>
        </nav>
        <ThemeToggle />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
