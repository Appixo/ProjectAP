'use client'

import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

function readInitial(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readInitial)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    const root = document.documentElement
    if (next === 'light') root.classList.add('light')
    else root.classList.remove('light')
    try {
      localStorage.setItem('theme', next)
    } catch {}
  }

  const label = theme === 'dark' ? 'Switch to light' : 'Switch to dark'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="text-[12px] text-muted hover:text-ink px-2 py-1 rounded border border-border hover:border-border-2"
    >
      {mounted ? (theme === 'dark' ? 'Light' : 'Dark') : '·'}
    </button>
  )
}
