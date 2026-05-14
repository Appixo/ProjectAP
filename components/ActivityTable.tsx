export interface ActivityRow {
  id: number
  name: string
  start_at: string
  distance_m: number
  moving_time_s: number
  average_heartrate: number | null
  average_speed_mps: number | null
}

function paceMinPerKm(mps: number | null): string {
  if (!mps || mps <= 0) return '—'
  const minPerKm = 1000 / mps / 60
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function duration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    timeZone: 'Europe/Amsterdam',
    day: '2-digit',
    month: 'short',
  })
}

export function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-600">No runs yet.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-neutral-600 border-b border-neutral-200">
            <th className="py-2 pr-4 font-medium">Date</th>
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium text-right">km</th>
            <th className="py-2 pr-4 font-medium text-right">Pace</th>
            <th className="py-2 pr-4 font-medium text-right">HR</th>
            <th className="py-2 font-medium text-right">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-neutral-100">
              <td className="py-2 pr-4 whitespace-nowrap">{dateLabel(r.start_at)}</td>
              <td className="py-2 pr-4 truncate max-w-xs">{r.name}</td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {(r.distance_m / 1000).toFixed(2)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {paceMinPerKm(r.average_speed_mps)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {r.average_heartrate ? Math.round(r.average_heartrate) : '—'}
              </td>
              <td className="py-2 text-right tabular-nums">
                {duration(r.moving_time_s)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
