import { requireOwner } from '@/lib/auth/owner'
import { ymdInAmsterdam } from '@/lib/time/week'
import { YearHeatmap, type HeatmapDay } from '@/components/dashboard/YearHeatmap'

interface ActivityRow {
  id: number
  start_at: string
  distance_m: number
  moving_time_s: number
  type: string
  average_heartrate: number | null
}

interface SessionRow {
  session_at: string
  session_at_local: string
  modality: string
  duration_min: number | null
}

const MODALITY_HUMAN: Record<string, string> = {
  strength_upper: 'upper',
  strength_lower: 'lower',
  strength_full: 'full',
  football: 'football',
  cycling: 'cycling',
  swimming: 'swimming',
  mobility: 'mobility',
  run_easy: 'easy',
  run_tempo: 'tempo',
  run_long: 'long',
  run_threshold: 'threshold',
  run_vo2: 'vo2',
  run_race: 'race',
  run_recovery: 'recovery',
  other: 'other',
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

function buildHeatmapDays(
  activities: { start_at: string; distance_m: number; moving_time_s: number; type: string }[],
  sessions: SessionRow[],
): HeatmapDay[] {
  // Aggregate by Amsterdam YMD. Activities contribute moving_time_s (incl.
  // non-run types like Workout/football synced via Strava). Sessions
  // contribute duration_min ONLY when they are not run-modality (the run
  // already appears as an activity) — this is the safe-against-double-count
  // rule for the common case.
  const byDay = new Map<
    string,
    { totalMin: number; parts: string[] }
  >()

  const ensure = (ymd: string) => {
    let cur = byDay.get(ymd)
    if (!cur) {
      cur = { totalMin: 0, parts: [] }
      byDay.set(ymd, cur)
    }
    return cur
  }

  for (const a of activities) {
    const ymd = ymdInAmsterdam(new Date(a.start_at))
    const min = Math.round(a.moving_time_s / 60)
    const cell = ensure(ymd)
    cell.totalMin += min
    if (a.type === 'Run') {
      cell.parts.push(`${(a.distance_m / 1000).toFixed(1)} km run`)
    } else {
      cell.parts.push(`${min} min ${a.type.toLowerCase()}`)
    }
  }

  for (const s of sessions) {
    if (!s.duration_min) continue
    if (s.modality.startsWith('run_')) continue // run already covered by activities
    const ymd = s.session_at_local.slice(0, 10)
    const cell = ensure(ymd)
    cell.totalMin += s.duration_min
    cell.parts.push(`${s.duration_min} min ${MODALITY_HUMAN[s.modality] ?? s.modality}`)
  }

  // Build the rolling 365-day window ending today. Empty days are still
  // emitted so the heatmap grid has every cell.
  const today = ymdInAmsterdam(new Date())
  const out: HeatmapDay[] = []
  for (let i = 364; i >= 0; i--) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - i)
    const ymd = ymdInAmsterdam(d)
    const cell = byDay.get(ymd)
    out.push({
      ymd,
      totalMin: cell?.totalMin ?? 0,
      breakdown: cell?.parts.join(' + ') ?? '',
    })
    if (ymd === today) break
  }
  return out
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
  const { supabase, user } = await requireOwner()

  // Last 365 days for the heatmap. Pull every Run AND every training_session
  // with a duration_min so the cell intensity counts all modalities.
  const heatmapStartIso = new Date(
    Date.now() - 364 * 86400 * 1000,
  ).toISOString()

  const [
    { data: activitiesRaw },
    { data: yearActivitiesRaw },
    { data: yearSessionsRaw },
  ] = await Promise.all([
    supabase
      .from('activities')
      .select(
        'id, start_at, distance_m, moving_time_s, type, average_heartrate',
      )
      .eq('user_id', user.id)
      .eq('type', 'Run')
      .order('start_at', { ascending: false })
      .returns<ActivityRow[]>(),
    supabase
      .from('activities')
      .select('start_at, distance_m, moving_time_s, type')
      .eq('user_id', user.id)
      .gte('start_at', heatmapStartIso)
      .returns<{ start_at: string; distance_m: number; moving_time_s: number; type: string }[]>(),
    supabase
      .from('training_sessions')
      .select('session_at, session_at_local, modality, duration_min')
      .eq('user_id', user.id)
      .gte('session_at', heatmapStartIso)
      .neq('status', 'planned')
      .returns<SessionRow[]>(),
  ])

  const activities = activitiesRaw ?? []
  const heatmapDays = buildHeatmapDays(yearActivitiesRaw ?? [], yearSessionsRaw ?? [])

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

      <YearHeatmap days={heatmapDays} />

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
