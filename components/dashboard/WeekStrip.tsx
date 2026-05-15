import { type RunType } from '@/lib/run/classify'

export interface WeekStripRun {
  id: number
  start_at: string
  distance_m: number
  moving_time_s: number
  runType: RunType
}

export interface WeekStripSession {
  id: string
  session_at_local: string
  modality: string
  duration_min: number | null
  rpe: number | null
}

export interface WeekStripProps {
  weekLabel: string
  monday: string
  todayYmd: string
  runs: WeekStripRun[]
  sessions: WeekStripSession[]
}

interface DayItem {
  kind: 'run' | 'session'
  primary: string
  secondary: string
  dotClass: string
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function ymdFromIsoUtc(iso: string): string {
  // For activities (UTC start_at): use Amsterdam-local YMD.
  return new Date(iso).toLocaleDateString('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function ymdFromLocalNaive(localIso: string): string {
  // session_at_local is a naive timestamp string like "2026-05-15T18:30:00"
  return localIso.slice(0, 10)
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

function dayNumber(ymd: string): number {
  return Number(ymd.slice(8, 10))
}

function runDotClass(type: RunType): string {
  return {
    easy: 'bg-type-easy',
    tempo: 'bg-type-tempo',
    long: 'bg-type-long',
    recovery: 'bg-type-recovery',
    race: 'bg-type-race',
  }[type]
}

function sessionDotClass(modality: string): string {
  switch (modality) {
    case 'strength_upper':
    case 'strength_lower':
      return 'bg-accent'
    case 'football':
      return 'bg-warn'
    case 'mobility':
      return 'bg-success'
    default:
      return 'bg-faint'
  }
}

const MODALITY_SHORT: Record<string, string> = {
  strength_upper: 'upper',
  strength_lower: 'lower',
  football: 'football',
  mobility: 'mobility',
  other: 'other',
}

export function WeekStrip({
  weekLabel,
  monday,
  todayYmd,
  runs,
  sessions,
}: WeekStripProps) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const ymd = addDaysYmd(monday, i)
    return {
      ymd,
      weekday: WEEKDAY_LABELS[i],
      dayNum: dayNumber(ymd),
      isToday: ymd === todayYmd,
      isFuture: ymd > todayYmd,
      items: [] as DayItem[],
    }
  })
  const byYmd = new Map(days.map(d => [d.ymd, d]))

  for (const r of runs) {
    const ymd = ymdFromIsoUtc(r.start_at)
    const cell = byYmd.get(ymd)
    if (!cell) continue
    cell.items.push({
      kind: 'run',
      primary: `${(r.distance_m / 1000).toFixed(1)} km`,
      secondary: r.runType,
      dotClass: runDotClass(r.runType),
    })
  }

  for (const s of sessions) {
    const ymd = ymdFromLocalNaive(s.session_at_local)
    const cell = byYmd.get(ymd)
    if (!cell) continue
    cell.items.push({
      kind: 'session',
      primary: s.duration_min ? `${s.duration_min} min` : '—',
      secondary: MODALITY_SHORT[s.modality] ?? s.modality,
      dotClass: sessionDotClass(s.modality),
    })
  }

  const totalKm = runs.reduce((s, r) => s + r.distance_m / 1000, 0)
  const sessionCount = sessions.length

  return (
    <section className="card bg-panel border border-border rounded-[4px] mb-4">
      <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
          This week
        </h2>
        <span className="font-mono text-[11px] text-muted -tracking-[0.01em]">
          {weekLabel}
        </span>
      </div>

      <div className="grid grid-cols-7">
        {days.map(d => (
          <div
            key={d.ymd}
            className={`px-3 py-3 border-r border-border last:border-r-0 min-h-28 ${
              d.isToday ? 'bg-accent-soft' : ''
            } ${d.isFuture ? 'opacity-60' : ''}`}
          >
            <div className="flex items-baseline justify-between mb-2">
              <span
                className={`text-[10px] uppercase tracking-[0.1em] ${
                  d.isToday ? 'text-accent font-semibold' : 'text-muted'
                }`}
              >
                {d.weekday}
              </span>
              <span
                className={`font-mono text-[12px] -tracking-[0.01em] ${
                  d.isToday ? 'text-ink font-medium' : 'text-ink-2'
                }`}
              >
                {d.dayNum}
              </span>
            </div>

            {d.items.length === 0 ? (
              <div className="text-[11px] text-faint">—</div>
            ) : (
              <ul className="space-y-1.5">
                {d.items.map((it, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-1.5 text-[11px] leading-tight"
                  >
                    <span
                      className={`inline-block w-[6px] h-[6px] rounded-full mt-[5px] shrink-0 ${it.dotClass}`}
                    />
                    <div className="min-w-0">
                      <div className="font-mono text-ink -tracking-[0.01em] truncate">
                        {it.primary}
                      </div>
                      <div className="text-muted truncate">{it.secondary}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="px-4 py-2.5 border-t border-border flex justify-between font-mono text-[11px] text-muted -tracking-[0.01em]">
        <span>
          {totalKm.toFixed(1)} km · {runs.length} run{runs.length === 1 ? '' : 's'}
        </span>
        <span>
          {sessionCount} session{sessionCount === 1 ? '' : 's'}
        </span>
      </div>
    </section>
  )
}
