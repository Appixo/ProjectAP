'use client'

import { useEffect, useRef, useState } from 'react'
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
  status?: 'planned' | 'completed' | 'skipped' | null
  description?: SessionDescription | null
  format?: string | null
  notes?: string | null
  // When a planned run matches a Strava activity, the actuals are attached
  // here so the popover can show both prescription and result.
  matched_run?: WeekStripRun | null
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
  title?: string
  prevHref?: string
  nextHref?: string
  /** null when the strip already shows the current week. */
  todayHref?: string | null
}

interface DayItem {
  key: string
  kind: 'run' | 'session'
  primary: string
  secondary: string
  dotClass: string
  status: 'planned' | 'completed' | 'skipped'
  details: ItemDetail[] | null
}

interface ItemDetail {
  label: string
  value: string
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function ymdFromIsoUtc(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function ymdFromLocalNaive(localIso: string): string {
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
    case 'cycling':
    case 'swimming':
      return 'bg-success'
    case 'rest':
      return 'bg-faint'
    default:
      return 'bg-faint'
  }
}

const MODALITY_LABEL: Record<string, string> = {
  strength_upper: 'Strength upper',
  strength_lower: 'Strength lower',
  strength_full: 'Strength full',
  football: 'Football',
  mobility: 'Mobility',
  cycling: 'Cycling',
  swimming: 'Swimming',
  run_easy: 'Easy run',
  run_tempo: 'Tempo run',
  run_long: 'Long run',
  run_threshold: 'Threshold run',
  run_vo2: 'VO2 run',
  run_race: 'Race',
  run_recovery: 'Recovery run',
  rest: 'Rest',
  other: 'Other',
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

function timeOfDay(localIso: string): string {
  // "2026-05-18T19:00:00" → "19:00"
  return localIso.slice(11, 16)
}

function detailsForSession(s: WeekStripSession): ItemDetail[] {
  const out: ItemDetail[] = []
  out.push({ label: 'Modality', value: MODALITY_LABEL[s.modality] ?? s.modality })
  out.push({ label: 'Time', value: timeOfDay(s.session_at_local) })
  out.push({
    label: 'Status',
    value: (s.status ?? 'completed').replace(/^./, c => c.toUpperCase()),
  })
  const d = s.description ?? null
  if (d?.target_distance_km != null) {
    out.push({ label: 'Target dist', value: `${d.target_distance_km} km` })
  }
  if (d?.target_duration_min != null) {
    out.push({ label: 'Target dur', value: `${d.target_duration_min} min` })
  }
  if (s.duration_min != null) {
    out.push({ label: 'Logged dur', value: `${s.duration_min} min` })
  }
  if (d?.target_hr_min != null && d?.target_hr_max != null) {
    out.push({ label: 'Target HR', value: `${d.target_hr_min}–${d.target_hr_max} bpm` })
  } else if (d?.target_hr_max != null) {
    out.push({ label: 'Max HR', value: `≤ ${d.target_hr_max} bpm` })
  } else if (d?.target_hr_min != null) {
    out.push({ label: 'Min HR', value: `≥ ${d.target_hr_min} bpm` })
  }
  const paceMin = paceLabel(d?.target_pace_s_per_km_min)
  const paceMax = paceLabel(d?.target_pace_s_per_km_max)
  if (paceMin && paceMax) out.push({ label: 'Target pace', value: `${paceMin}–${paceMax}` })
  else if (paceMin) out.push({ label: 'Target pace', value: paceMin })
  else if (paceMax) out.push({ label: 'Target pace', value: paceMax })
  if (s.rpe != null) out.push({ label: 'RPE', value: String(s.rpe) })
  if (s.format) out.push({ label: 'Format', value: s.format })
  if (d?.reason) out.push({ label: 'Why', value: d.reason })
  if (s.notes) out.push({ label: 'Notes', value: s.notes })
  // Append actual run results when this session is a planned-run matched
  // to a Strava activity, so the popover shows prescription + execution.
  if (s.matched_run) {
    const r = s.matched_run
    const km = r.distance_m / 1000
    const min = r.moving_time_s / 60
    const pacePerKm = min / km
    const pm = Math.floor(pacePerKm)
    const ps = Math.round((pacePerKm - pm) * 60)
    out.push({ label: 'Actual dist', value: `${km.toFixed(2)} km` })
    out.push({
      label: 'Actual time',
      value: `${Math.floor(min)} min ${Math.round((min % 1) * 60)} s`,
    })
    out.push({ label: 'Actual pace', value: `${pm}:${String(ps).padStart(2, '0')}/km` })
  }
  return out
}

function detailsForRun(r: WeekStripRun): ItemDetail[] {
  const km = r.distance_m / 1000
  const min = r.moving_time_s / 60
  const paceMinPerKm = min / km
  const m = Math.floor(paceMinPerKm)
  const s = Math.round((paceMinPerKm - m) * 60)
  return [
    { label: 'Distance', value: `${km.toFixed(2)} km` },
    { label: 'Moving time', value: `${Math.floor(min)} min ${Math.round((min % 1) * 60)} s` },
    { label: 'Pace', value: `${m}:${String(s).padStart(2, '0')}/km` },
    { label: 'Type', value: r.runType },
    { label: 'Time', value: new Date(r.start_at).toLocaleTimeString('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' }) },
  ]
}

export function WeekStrip({
  weekLabel,
  monday,
  todayYmd,
  runs,
  sessions,
  title = 'This week',
  prevHref,
  nextHref,
  todayHref,
}: WeekStripProps) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Close the popover when the user clicks anywhere outside it. We bind to
  // mousedown so the click that opens it doesn't immediately close.
  useEffect(() => {
    if (openKey === null) return
    function onDocMousedown(e: MouseEvent) {
      if (!containerRef.current) return
      if (!(e.target instanceof Node)) return
      const popoverHit = (e.target as Element).closest('[data-popover="true"]')
      const itemHit = (e.target as Element).closest('[data-strip-item="true"]')
      if (popoverHit || itemHit) return
      setOpenKey(null)
    }
    document.addEventListener('mousedown', onDocMousedown)
    return () => document.removeEventListener('mousedown', onDocMousedown)
  }, [openKey])

  // Close on Escape.
  useEffect(() => {
    if (openKey === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenKey(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openKey])

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
      key: `run-${r.id}`,
      kind: 'run',
      primary: `${(r.distance_m / 1000).toFixed(1)} km`,
      secondary: r.runType,
      dotClass: runDotClass(r.runType),
      status: 'completed',
      details: detailsForRun(r),
    })
  }

  for (const s of sessions) {
    const ymd = ymdFromLocalNaive(s.session_at_local)
    const cell = byYmd.get(ymd)
    if (!cell) continue
    const status: 'planned' | 'completed' | 'skipped' = s.status ?? 'completed'
    const d = s.description
    let primary: string
    if (s.duration_min != null) primary = `${s.duration_min} min`
    else if (d?.target_distance_km != null) primary = `${d.target_distance_km} km`
    else if (d?.target_duration_min != null) primary = `${d.target_duration_min} min`
    else primary = '—'
    cell.items.push({
      key: `session-${s.id}`,
      kind: 'session',
      primary,
      secondary: MODALITY_SHORT[s.modality] ?? s.modality,
      dotClass: sessionDotClass(s.modality),
      status,
      details: detailsForSession(s),
    })
  }

  const completedRuns = runs.length
  const totalKm = runs.reduce((s, r) => s + r.distance_m / 1000, 0)
  const completedSessions = sessions.filter(s => (s.status ?? 'completed') === 'completed').length
  const plannedSessions = sessions.filter(s => s.status === 'planned').length

  return (
    <section
      ref={containerRef}
      className="card bg-panel border border-border rounded-[4px] mb-4 relative"
    >
      <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold shrink-0">
            {title}
          </h2>
          <span className="font-mono text-[11px] text-muted -tracking-[0.01em] truncate">
            {weekLabel}
          </span>
        </div>
        {(prevHref || nextHref) && (
          <nav className="flex items-center gap-1 shrink-0" aria-label="Week navigation">
            {prevHref && (
              <a
                href={prevHref}
                className="font-mono text-[11px] text-muted hover:text-ink border border-border rounded px-1.5 py-0.5 hover:border-border-2"
                aria-label="Previous week"
              >
                ← prev
              </a>
            )}
            {todayHref && (
              <a
                href={todayHref}
                className="font-mono text-[11px] text-muted hover:text-ink border border-border rounded px-1.5 py-0.5 hover:border-border-2"
              >
                today
              </a>
            )}
            {nextHref && (
              <a
                href={nextHref}
                className="font-mono text-[11px] text-muted hover:text-ink border border-border rounded px-1.5 py-0.5 hover:border-border-2"
                aria-label="Next week"
              >
                next →
              </a>
            )}
          </nav>
        )}
      </div>

      <div className="grid grid-cols-7">
        {days.map(d => (
          <div
            key={d.ymd}
            className={`px-3 py-3 border-r border-border last:border-r-0 min-h-28 relative ${
              d.isToday ? 'bg-accent-soft' : ''
            } ${d.isFuture ? 'opacity-90' : ''}`}
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
                {d.items.map(it => {
                  const isOpen = openKey === it.key
                  return (
                    <li key={it.key} className="relative">
                      <button
                        type="button"
                        data-strip-item="true"
                        onClick={() => setOpenKey(isOpen ? null : it.key)}
                        aria-expanded={isOpen}
                        className={`w-full flex items-start gap-1.5 text-left text-[11px] leading-tight rounded px-1 -mx-1 py-0.5 hover:bg-accent-soft focus:outline-none focus:bg-accent-soft transition-colors ${
                          it.status === 'planned' ? 'opacity-80' : ''
                        } ${isOpen ? 'bg-accent-soft' : ''}`}
                      >
                        <span
                          className={`inline-block w-[6px] h-[6px] mt-[5px] shrink-0 ${
                            it.status === 'planned'
                              ? `rounded-full border border-ink-2 bg-transparent`
                              : `rounded-full ${it.dotClass}`
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div
                            className={`font-mono -tracking-[0.01em] truncate ${
                              it.status === 'planned' ? 'text-ink-2 italic' : 'text-ink'
                            }`}
                          >
                            {it.primary}
                          </div>
                          <div className="text-muted truncate">{it.secondary}</div>
                        </div>
                      </button>

                      {isOpen && it.details && (
                        <ItemPopover
                          details={it.details}
                          onClose={() => setOpenKey(null)}
                        />
                      )}
                    </li>
                  )
                })}
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

function ItemPopover({
  details,
  onClose,
}: {
  details: ItemDetail[]
  onClose: () => void
}) {
  return (
    <div
      data-popover="true"
      role="dialog"
      className="absolute z-20 top-full left-0 mt-1 w-[240px] rounded border border-border bg-panel shadow-lg p-3 space-y-1.5 text-[11px]"
    >
      <div className="flex justify-end -mt-1 -mr-1">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted hover:text-ink text-[14px] leading-none px-1"
        >
          ×
        </button>
      </div>
      <dl className="space-y-1">
        {details.map((d, idx) => (
          <div key={idx} className="grid grid-cols-[80px_1fr] gap-2">
            <dt className="text-muted uppercase tracking-[0.06em] text-[10px] mt-0.5">
              {d.label}
            </dt>
            <dd className="text-ink-2 break-words">{d.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
