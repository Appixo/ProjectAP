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
  // M1+M2 additions for planning surface
  status?: 'planned' | 'completed' | 'skipped' | null
  description?: SessionDescription | null
  format?: string | null
  notes?: string | null
}

export interface SessionDescription {
  target_distance_km?: number
  target_duration_min?: number
  target_hr_min?: number
  target_hr_max?: number
  target_pace_s_per_km_min?: number
  target_pace_s_per_km_max?: number
  reason?: string
}

export interface WeekStripProps {
  weekLabel: string
  monday: string
  todayYmd: string
  runs: WeekStripRun[]
  sessions: WeekStripSession[]
  // Title can be overridden so the same component renders "This week" or
  // "Week of May 25" in the upcoming-weeks view.
  title?: string
}

interface DayItem {
  kind: 'run' | 'session'
  primary: string
  secondary: string
  dotClass: string
  status: 'planned' | 'completed' | 'skipped'
  tooltip: string | null
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
  if (modality.startsWith('strength_')) return 'bg-accent'
  if (modality.startsWith('run_')) return 'bg-type-easy'
  switch (modality) {
    case 'football':
      return 'bg-warn'
    case 'mobility':
      return 'bg-success'
    case 'cycling':
    case 'swimming':
      return 'bg-success'
    case 'rest':
      return 'bg-faint'
    default:
      return 'bg-faint'
  }
}

const MODALITY_SHORT: Record<string, string> = {
  strength_upper: 'upper',
  strength_lower: 'lower',
  strength_full: 'full',
  football: 'football',
  mobility: 'mobility',
  cycling: 'cycling',
  swimming: 'swimming',
  run_easy: 'easy',
  run_tempo: 'tempo',
  run_long: 'long',
  run_threshold: 'threshold',
  run_vo2: 'vo2',
  run_race: 'race',
  run_recovery: 'recovery',
  rest: 'rest',
  other: 'other',
}

function paceLabel(spk?: number): string | null {
  if (!spk || !Number.isFinite(spk)) return null
  const m = Math.floor(spk / 60)
  const s = spk % 60
  return `${m}:${String(s).padStart(2, '0')}/km`
}

function describeSession(s: WeekStripSession): string | null {
  const d = s.description
  const parts: string[] = []
  if (s.status === 'planned') parts.push('PLANNED')
  parts.push(MODALITY_SHORT[s.modality] ?? s.modality)
  if (d?.target_distance_km != null) parts.push(`${d.target_distance_km} km`)
  if (s.duration_min != null) parts.push(`${s.duration_min} min`)
  if (d?.target_duration_min != null && s.duration_min == null) {
    parts.push(`${d.target_duration_min} min`)
  }
  if (d?.target_hr_min != null && d?.target_hr_max != null) {
    parts.push(`HR ${d.target_hr_min}-${d.target_hr_max}`)
  } else if (d?.target_hr_max != null) {
    parts.push(`HR ≤${d.target_hr_max}`)
  } else if (d?.target_hr_min != null) {
    parts.push(`HR ≥${d.target_hr_min}`)
  }
  const paceMin = paceLabel(d?.target_pace_s_per_km_min)
  const paceMax = paceLabel(d?.target_pace_s_per_km_max)
  if (paceMin && paceMax) parts.push(`${paceMin}–${paceMax}`)
  else if (paceMin) parts.push(paceMin)
  else if (paceMax) parts.push(paceMax)
  if (s.rpe != null) parts.push(`RPE ${s.rpe}`)
  if (s.format) parts.push(s.format)
  if (d?.reason) parts.push(d.reason)
  if (s.notes) parts.push(s.notes)
  return parts.length > 0 ? parts.join('\n') : null
}

export function WeekStrip({
  weekLabel,
  monday,
  todayYmd,
  runs,
  sessions,
  title = 'This week',
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
      status: 'completed',
      tooltip: null,
    })
  }

  for (const s of sessions) {
    const ymd = ymdFromLocalNaive(s.session_at_local)
    const cell = byYmd.get(ymd)
    if (!cell) continue
    const status: 'planned' | 'completed' | 'skipped' = s.status ?? 'completed'
    const isPlanned = status === 'planned'
    const d = s.description
    let primary: string
    if (s.duration_min != null) primary = `${s.duration_min} min`
    else if (d?.target_distance_km != null) primary = `${d.target_distance_km} km`
    else if (d?.target_duration_min != null) primary = `${d.target_duration_min} min`
    else primary = '—'
    cell.items.push({
      kind: 'session',
      primary,
      secondary: MODALITY_SHORT[s.modality] ?? s.modality,
      dotClass: sessionDotClass(s.modality),
      status,
      tooltip: isPlanned || d != null || s.notes ? describeSession(s) : null,
    })
  }

  const completedRuns = runs.length
  const totalKm = runs.reduce((s, r) => s + r.distance_m / 1000, 0)
  const completedSessions = sessions.filter(s => (s.status ?? 'completed') === 'completed').length
  const plannedSessions = sessions.filter(s => s.status === 'planned').length

  return (
    <section className="card bg-panel border border-border rounded-[4px] mb-4">
      <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
          {title}
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
            } ${d.isFuture ? 'opacity-70' : ''}`}
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
                    className={`group relative flex items-start gap-1.5 text-[11px] leading-tight ${
                      it.tooltip ? 'cursor-help' : ''
                    } ${it.status === 'planned' ? 'opacity-70' : ''}`}
                    title={it.tooltip ?? undefined}
                  >
                    <span
                      className={`inline-block w-[6px] h-[6px] mt-[5px] shrink-0 ${
                        it.status === 'planned'
                          ? `rounded-full border border-ink-2 bg-transparent`
                          : `rounded-full ${it.dotClass}`
                      }`}
                    />
                    <div className="min-w-0">
                      <div
                        className={`font-mono -tracking-[0.01em] truncate ${
                          it.status === 'planned' ? 'text-ink-2 italic' : 'text-ink'
                        }`}
                      >
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
          {totalKm.toFixed(1)} km · {completedRuns} run{completedRuns === 1 ? '' : 's'}
        </span>
        <span>
          {completedSessions} session{completedSessions === 1 ? '' : 's'}
          {plannedSessions > 0 ? ` · ${plannedSessions} planned` : ''}
        </span>
      </div>
    </section>
  )
}
