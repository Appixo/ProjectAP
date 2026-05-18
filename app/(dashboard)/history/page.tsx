import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ymdInAmsterdam } from '@/lib/time/week'

interface ActivityRow {
  id: number
  start_at: string
  distance_m: number
  moving_time_s: number
  type: string
  average_heartrate: number | null
}

interface MonthBucket {
  key: string // YYYY-MM
  label: string // "May 2026"
  year: number
  month: number
  totalKm: number
  runs: number
  longestKm: number
  totalSeconds: number
  avgHr: number | null
  hrSamples: number
}

interface YearBucket {
  year: number
  totalKm: number
  runs: number
  longestKm: number
  totalSeconds: number
}

function ymdToMonthKey(ymd: string): string {
  return ymd.slice(0, 7)
}

function monthLabel(ymd: string): string {
  return new Date(ymd + '-01T00:00:00Z').toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatAvgPace(km: number, seconds: number): string {
  if (km <= 0 || seconds <= 0) return '—'
  const spk = seconds / km
  const m = Math.floor(spk / 60)
  const s = Math.round(spk % 60)
  return `${m}:${String(s).padStart(2, '0')}/km`
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>
}) {
  const sp = await searchParams
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: activitiesRaw } = await supabase
    .from('activities')
    .select(
      'id, start_at, distance_m, moving_time_s, type, average_heartrate',
    )
    .eq('type', 'Run')
    .order('start_at', { ascending: false })
    .returns<ActivityRow[]>()

  const activities = activitiesRaw ?? []

  // Bucket per Amsterdam-local month.
  const monthMap = new Map<string, MonthBucket>()
  const yearMap = new Map<number, YearBucket>()

  for (const a of activities) {
    const ymd = ymdInAmsterdam(new Date(a.start_at))
    const monthKey = ymdToMonthKey(ymd)
    const [yStr, mStr] = monthKey.split('-')
    const year = Number(yStr)
    const month = Number(mStr)
    const km = a.distance_m / 1000

    let mb = monthMap.get(monthKey)
    if (!mb) {
      mb = {
        key: monthKey,
        label: monthLabel(monthKey),
        year,
        month,
        totalKm: 0,
        runs: 0,
        longestKm: 0,
        totalSeconds: 0,
        avgHr: null,
        hrSamples: 0,
      }
      monthMap.set(monthKey, mb)
    }
    mb.totalKm += km
    mb.runs += 1
    mb.longestKm = Math.max(mb.longestKm, km)
    mb.totalSeconds += a.moving_time_s
    if (a.average_heartrate != null && a.average_heartrate > 0) {
      mb.avgHr =
        ((mb.avgHr ?? 0) * mb.hrSamples + a.average_heartrate) / (mb.hrSamples + 1)
      mb.hrSamples += 1
    }

    let yb = yearMap.get(year)
    if (!yb) {
      yb = { year, totalKm: 0, runs: 0, longestKm: 0, totalSeconds: 0 }
      yearMap.set(year, yb)
    }
    yb.totalKm += km
    yb.runs += 1
    yb.longestKm = Math.max(yb.longestKm, km)
    yb.totalSeconds += a.moving_time_s
  }

  const months = [...monthMap.values()].sort((a, b) =>
    a.key < b.key ? 1 : a.key > b.key ? -1 : 0,
  )
  const years = [...yearMap.values()].sort((a, b) => b.year - a.year)

  // Selected month (?year=YYYY&month=MM) — when present, show that month's runs.
  let selectedMonth: MonthBucket | null = null
  let selectedRuns: ActivityRow[] = []
  if (sp.year && sp.month) {
    const key = `${sp.year}-${sp.month.padStart(2, '0')}`
    selectedMonth = monthMap.get(key) ?? null
    if (selectedMonth) {
      selectedRuns = activities.filter(a => ymdToMonthKey(ymdInAmsterdam(new Date(a.start_at))) === key)
    }
  }

  return (
    <div className="max-w-[1200px] mx-auto px-7 pt-8 pb-20 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink">History</h1>
        <a href="/" className="text-sm text-muted hover:text-ink">
          ← dashboard
        </a>
      </header>

      <section className="card bg-panel border border-border rounded-[4px]">
        <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
            Yearly totals
          </h2>
          <span className="font-mono text-[11px] text-muted">all runs</span>
        </div>
        {years.length === 0 ? (
          <div className="px-4 py-6 text-sm text-faint">No runs yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="px-4 py-2 font-medium">Year</th>
                <th className="px-4 py-2 font-medium text-right">Runs</th>
                <th className="px-4 py-2 font-medium text-right">Total km</th>
                <th className="px-4 py-2 font-medium text-right">Longest</th>
                <th className="px-4 py-2 font-medium text-right">Time</th>
                <th className="px-4 py-2 font-medium text-right">Avg pace</th>
              </tr>
            </thead>
            <tbody>
              {years.map(y => (
                <tr key={y.year} className="border-b border-border text-ink-2 hover:bg-accent-soft">
                  <td className="px-4 py-2 font-mono">{y.year}</td>
                  <td className="px-4 py-2 text-right font-mono">{y.runs}</td>
                  <td className="px-4 py-2 text-right font-mono">{y.totalKm.toFixed(1)}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {y.longestKm.toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {formatDuration(y.totalSeconds)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {formatAvgPace(y.totalKm, y.totalSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card bg-panel border border-border rounded-[4px]">
        <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
            Monthly breakdown
          </h2>
          <span className="font-mono text-[11px] text-muted">
            click a month to see its runs
          </span>
        </div>
        {months.length === 0 ? (
          <div className="px-4 py-6 text-sm text-faint">No runs yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="px-4 py-2 font-medium">Month</th>
                <th className="px-4 py-2 font-medium text-right">Runs</th>
                <th className="px-4 py-2 font-medium text-right">Total km</th>
                <th className="px-4 py-2 font-medium text-right">Longest</th>
                <th className="px-4 py-2 font-medium text-right">Time</th>
                <th className="px-4 py-2 font-medium text-right">Avg pace</th>
                <th className="px-4 py-2 font-medium text-right">Avg HR</th>
              </tr>
            </thead>
            <tbody>
              {months.map(m => {
                const isSelected =
                  selectedMonth != null && selectedMonth.key === m.key
                return (
                  <tr
                    key={m.key}
                    className={`border-b border-border text-ink-2 hover:bg-accent-soft ${
                      isSelected ? 'bg-accent-soft' : ''
                    }`}
                  >
                    <td className="px-4 py-2">
                      <a
                        href={`/history?year=${m.year}&month=${String(m.month).padStart(2, '0')}`}
                        className="font-mono hover:underline"
                      >
                        {m.label}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{m.runs}</td>
                    <td className="px-4 py-2 text-right font-mono">{m.totalKm.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {m.longestKm.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {formatDuration(m.totalSeconds)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {formatAvgPace(m.totalKm, m.totalSeconds)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {m.avgHr != null ? m.avgHr.toFixed(0) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {selectedMonth && (
        <section className="card bg-panel border border-border rounded-[4px]">
          <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
              {selectedMonth.label}
            </h2>
            <a
              href="/history"
              className="font-mono text-[11px] text-muted hover:text-ink"
            >
              clear
            </a>
          </div>
          {selectedRuns.length === 0 ? (
            <div className="px-4 py-6 text-sm text-faint">No runs.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium text-right">Distance</th>
                  <th className="px-4 py-2 font-medium text-right">Time</th>
                  <th className="px-4 py-2 font-medium text-right">Pace</th>
                  <th className="px-4 py-2 font-medium text-right">Avg HR</th>
                </tr>
              </thead>
              <tbody>
                {selectedRuns.map(r => {
                  const km = r.distance_m / 1000
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-border text-ink-2 hover:bg-accent-soft"
                    >
                      <td className="px-4 py-2 font-mono">
                        <a
                          href={`https://www.strava.com/activities/${r.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {ymdInAmsterdam(new Date(r.start_at))}
                        </a>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{km.toFixed(2)} km</td>
                      <td className="px-4 py-2 text-right font-mono">
                        {formatDuration(r.moving_time_s)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {formatAvgPace(km, r.moving_time_s)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {r.average_heartrate != null
                          ? r.average_heartrate.toFixed(0)
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  )
}
