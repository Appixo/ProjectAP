export interface AdherenceProps {
  completed: number
  skipped: number
  missed: number // planned + past + not completed
}

export function Adherence({
  completed,
  skipped,
  missed,
}: AdherenceProps) {
  // Adherence = completed / (planned-and-past). Skipped counts as "didn't do
  // it" same as missed, just marked deliberately.
  const denominator = completed + skipped + missed
  const pct =
    denominator === 0 ? null : Math.round((completed / denominator) * 100)

  return (
    <section className="card bg-panel border border-border rounded-[4px] mb-4">
      <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
          Adherence — last 14 days
        </h2>
        <span className="font-mono text-[11px] text-muted -tracking-[0.01em]">
          completed vs planned
        </span>
      </div>

      <div className="grid grid-cols-3">
        <div className="px-4 py-3 border-r border-border">
          <div className="text-[10px] uppercase tracking-[0.1em] text-muted mb-1">Adherence</div>
          <div className="font-mono text-[24px] -tracking-[0.01em] text-ink leading-none">
            {pct === null ? '—' : `${pct}%`}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {completed} of {denominator} planned
          </div>
        </div>
        <div className="px-4 py-3 border-r border-border">
          <div className="text-[10px] uppercase tracking-[0.1em] text-muted mb-1">Completed</div>
          <div className="font-mono text-[24px] -tracking-[0.01em] text-success leading-none">
            {completed}
          </div>
          <div className="text-[10px] text-muted mt-1">sessions done</div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.1em] text-muted mb-1">Missed</div>
          <div className="font-mono text-[24px] -tracking-[0.01em] text-warn leading-none">
            {missed}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {skipped > 0 ? `${skipped} marked skipped` : 'planned but undone'}
          </div>
        </div>
      </div>
    </section>
  )
}
