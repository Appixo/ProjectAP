import type { BestEfforts } from '@/lib/run/best_efforts'

interface Row {
  key: keyof BestEfforts
  label: string
}

const ROWS: Row[] = [
  { key: 'd_5k', label: '5K' },
  { key: 'd_10k', label: '10K' },
  { key: 'd_half', label: 'Half marathon' },
  { key: 'd_full', label: 'Marathon' },
]

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatPace(spk: number): string {
  const m = Math.floor(spk / 60)
  const s = Math.round(spk % 60)
  return `${m}:${String(s).padStart(2, '0')}/km`
}

function formatDate(ymd: string): string {
  return new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export interface PersonalBestsProps {
  best: BestEfforts
}

export function PersonalBests({ best }: PersonalBestsProps) {
  return (
    <section className="card bg-panel border border-border rounded-[4px] mb-4">
      <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
          Personal bests
        </h2>
        <span className="font-mono text-[11px] text-muted -tracking-[0.01em]">
          fastest run per distance
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4">
        {ROWS.map(row => {
          const entry = best[row.key]
          const hasActivity = entry != null && entry.activity_id != null
          const inner = (
            <div className="px-4 py-3 h-full">
              <div className="text-[10px] uppercase tracking-[0.1em] text-muted mb-1">
                {row.label}
              </div>
              {entry ? (
                <>
                  <div className="font-mono text-[18px] -tracking-[0.01em] text-ink leading-none mb-1.5">
                    {formatTime(entry.time_s)}
                  </div>
                  <div className="font-mono text-[11px] text-ink-2 -tracking-[0.01em]">
                    {formatPace(entry.pace_s_per_km)}
                  </div>
                  <div className="text-[10px] text-muted mt-0.5 truncate">
                    {formatDate(entry.date)} · {(entry.distance_m / 1000).toFixed(2)} km
                    {entry.source !== 'derived' && (
                      <span className="ml-1 uppercase tracking-[0.05em]">
                        · {entry.source}
                      </span>
                    )}
                  </div>
                  {entry.event_name && (
                    <div className="text-[10px] text-muted mt-0.5 truncate">
                      {entry.event_name}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="font-mono text-[18px] text-faint leading-none mb-1.5">—</div>
                  <div className="text-[10px] text-muted">no qualifying run yet</div>
                </>
              )}
            </div>
          )

          const baseClass =
            'border-r border-border last:border-r-0 md:border-b-0 border-b md:[&:nth-child(2)]:border-r [&:nth-child(2)]:border-r-0'

          if (hasActivity) {
            return (
              <a
                key={row.key}
                href={`https://www.strava.com/activities/${entry!.activity_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`${baseClass} hover:bg-accent-soft transition-colors`}
              >
                {inner}
              </a>
            )
          }
          return (
            <div key={row.key} className={baseClass}>
              {inner}
            </div>
          )
        })}
      </div>
    </section>
  )
}
