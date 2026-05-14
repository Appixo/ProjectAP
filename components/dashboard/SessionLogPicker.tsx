const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function SessionLogPicker({ todayYmd }: { todayYmd: string }) {
  const weekday = WEEKDAY[new Date(todayYmd + 'T12:00:00Z').getUTCDay()]

  return (
    <div className="card bg-panel border border-border rounded-[4px]">
      <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
          Log a session · {weekday}
        </h2>
        <span className="font-mono text-[11px] text-muted -tracking-[0.01em]">
          today
        </span>
      </div>
      <div className="px-4 py-4">
        <div className="flex flex-col gap-1.5">
          <div className="pick flex items-center justify-between px-3 py-2 border border-border-2 rounded-[3px] text-[13px] text-ink bg-panel">
            <span>● Run</span>
            <span className="font-mono text-[10px] text-accent border border-accent bg-accent-soft px-1.5 py-0.5 rounded-[2px] tracking-[0.04em]">
              auto · Strava
            </span>
          </div>
          {[
            'Strength — Upper',
            'Strength — Lower',
            'Football',
            'Other (cycle, swim…)',
          ].map((label, idx) => (
            <div
              key={label}
              className="pick flex items-center justify-between px-3 py-2 border border-dashed border-border-2 rounded-[3px] text-[13px] text-faint bg-panel"
            >
              <span>○ {label}</span>
              <span className="font-mono text-[11px] text-muted">
                {idx === 3 ? '—' : 'coming soon'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
