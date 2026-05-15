'use client'

import { useState } from 'react'

interface CopyPromptButtonProps {
  appUrl: string
}

export function CopyPromptButton({ appUrl }: CopyPromptButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [open, setOpen] = useState(false)

  const exportUrl = `${appUrl}/api/export`
  const prompt = [
    `Read my full training data (goals, runs, training sessions, daily logs) from this endpoint and analyze it:`,
    exportUrl,
    ``,
    `Pay close attention to context.goals — that is my own framing of what I'm training for. Tell me where to focus this week given the days remaining to my primary event. Be specific: one running session, one strength session, one risk to watch. If you notice a session I likely did but didn't log, POST it using context.write_endpoints.sessions.`,
  ].join('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
      setState('copied')
      setTimeout(() => setState('idle'), 2500)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 2500)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded border border-border bg-panel text-ink px-3 py-1.5 text-[12px] hover:border-border-2"
        >
          {state === 'copied'
            ? 'Copied ✓'
            : state === 'error'
              ? 'Copy failed'
              : 'Copy prompt for Claude'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="text-[11px] text-muted hover:text-ink"
        >
          {open ? 'hide' : 'preview'}
        </button>
      </div>
      {open && (
        <pre className="font-mono text-[11px] bg-panel border border-border rounded p-3 overflow-x-auto whitespace-pre-wrap text-ink-2">
          {prompt}
        </pre>
      )}
    </div>
  )
}
