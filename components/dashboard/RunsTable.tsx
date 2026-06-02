import { Fragment } from 'react'
import Link from 'next/link'
import { formatPace, type RunType } from '@/lib/run/classify'
import type { CompactLap } from '@/lib/run/laps'

export interface RunRow {
  id: number
  start_at: string
  distance_m: number
  moving_time_s: number
  average_heartrate: number | null
  average_speed_mps: number | null
  runType: RunType
  /** Compact per-lap splits from Strava, or null when none were ingested. */
  laps: CompactLap[] | null
}

interface RunsTableProps {
  weekLabel: string
  rows: RunRow[]
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtMonthDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    timeZone: 'Europe/Amsterdam',
    month: 'short',
    day: 'numeric',
  })
}

function fmtHms(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${m}:${String(sec).padStart(2, '0')}`
}

function typeDotClass(t: RunType): string {
  return {
    easy: 'bg-type-easy',
    tempo: 'bg-type-tempo',
    threshold: 'bg-type-threshold',
    vo2: 'bg-type-vo2',
    long: 'bg-type-long',
    recovery: 'bg-type-recovery',
    race: 'bg-type-race',
  }[t]
}

export function RunsTable({ weekLabel, rows }: RunsTableProps) {
  const totalKm = rows.reduce((s, r) => s + r.distance_m / 1000, 0)
  const totalSec = rows.reduce((s, r) => s + r.moving_time_s, 0)
  const totalAvgSpeed =
    rows.reduce((s, r) => s + (r.average_speed_mps ?? 0) * r.moving_time_s, 0) /
    Math.max(1, totalSec)
  const totalAvgHr =
    rows.reduce(
      (s, r) => s + (r.average_heartrate ?? 0) * r.moving_time_s,
      0,
    ) / Math.max(1, totalSec)

  return (
    <section className="card bg-panel border border-border rounded-[4px] mb-2">
      <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
          This week&rsquo;s runs
        </h2>
        <span className="font-mono text-[11px] text-muted -tracking-[0.01em]">
          {weekLabel} · {rows.length} runs
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left">
              <th className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.1em] text-muted font-semibold w-14"></th>
              <th className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.1em] text-muted font-semibold">
                Date
              </th>
              <th className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.1em] text-muted font-semibold text-right">
                km
              </th>
              <th className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.1em] text-muted font-semibold text-right">
                Pace
              </th>
              <th className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.1em] text-muted font-semibold text-right">
                Avg HR
              </th>
              <th className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.1em] text-muted font-semibold text-right">
                Time
              </th>
              <th className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.1em] text-muted font-semibold">
                Type
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-6 text-[13px] text-muted text-center border-t border-border"
                >
                  No runs logged this week yet.
                </td>
              </tr>
            )}
            {rows.map(r => {
              const dow = new Date(r.start_at).getUTCDay()
              const pace = r.average_speed_mps
                ? 1000 / r.average_speed_mps / 60
                : null
              const isLong = r.runType === 'long'
              const splitLaps =
                r.laps && r.laps.length > 1 ? r.laps : null
              return (
                <Fragment key={r.id}>
                  <tr className="border-t border-border">
                    <td className="px-4 py-2.5 font-mono text-[13px] text-ink-2 w-14">
                      {WEEKDAY_SHORT[dow]}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[13px] text-muted">
                      {fmtMonthDay(r.start_at)}
                    </td>
                    <td
                      className={`px-4 py-2.5 font-mono text-[13px] -tracking-[0.01em] text-right ${
                        isLong ? 'text-accent font-medium' : 'text-ink'
                      }`}
                    >
                      {(r.distance_m / 1000).toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[13px] -tracking-[0.01em] text-right text-ink">
                      {formatPace(pace)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[13px] -tracking-[0.01em] text-right text-ink">
                      {r.average_heartrate ? Math.round(r.average_heartrate) : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[13px] -tracking-[0.01em] text-right text-ink">
                      {fmtHms(r.moving_time_s)}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-ink-2">
                      <span
                        className={`inline-block w-[7px] h-[7px] rounded-full mr-1.5 align-[1px] ${typeDotClass(r.runType)}`}
                      />
                      {r.runType}
                    </td>
                  </tr>
                  {splitLaps && (
                    <tr>
                      <td colSpan={7} className="px-4 pb-2 pt-0">
                        <SplitsPanel laps={splitLaps} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {rows.length > 0 && (
              <tr>
                <td
                  colSpan={2}
                  className="px-4 pt-3 pb-3.5 text-[13px] text-ink font-medium border-t border-border-2"
                >
                  Total
                </td>
                <td className="px-4 pt-3 pb-3.5 font-mono text-[13px] -tracking-[0.01em] text-ink font-medium text-right border-t border-border-2">
                  {totalKm.toFixed(1)}
                </td>
                <td className="px-4 pt-3 pb-3.5 font-mono text-[13px] -tracking-[0.01em] text-ink font-medium text-right border-t border-border-2">
                  {formatPace(totalAvgSpeed > 0 ? 1000 / totalAvgSpeed / 60 : null)}
                </td>
                <td className="px-4 pt-3 pb-3.5 font-mono text-[13px] -tracking-[0.01em] text-ink font-medium text-right border-t border-border-2">
                  {totalAvgHr > 0 ? Math.round(totalAvgHr) : '—'}
                </td>
                <td className="px-4 pt-3 pb-3.5 font-mono text-[13px] -tracking-[0.01em] text-ink font-medium text-right border-t border-border-2">
                  {fmtHms(totalSec)}
                </td>
                <td className="px-4 pt-3 pb-3.5 border-t border-border-2" />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3">
        <div className="flex justify-between items-center text-[12px] text-muted">
          <span>Expand a run with laps to see its splits.</span>
          <Link href="/log" className="text-accent hover:underline">
            Daily log ▾
          </Link>
        </div>
      </div>
    </section>
  )
}

function lapPace(l: CompactLap): string {
  if (l.average_speed_mps && l.average_speed_mps > 0) {
    return formatPace(1000 / l.average_speed_mps / 60)
  }
  if (l.distance_m > 0 && l.moving_time_s > 0) {
    return formatPace(l.moving_time_s / 60 / (l.distance_m / 1000))
  }
  return '—'
}

// Native <details> disclosure — no client JS, works in a server component.
// Collapsed by default so the table stays compact; the summary names how many
// laps and lets the user open the per-lap breakdown on demand.
function SplitsPanel({ laps }: { laps: CompactLap[] }) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-[11px] text-muted hover:text-ink-2 select-none">
        <span className="group-open:hidden">▸ {laps.length} laps</span>
        <span className="hidden group-open:inline">▾ splits</span>
      </summary>
      <table className="w-full border-collapse mt-1.5 mb-1">
        <thead>
          <tr className="text-left">
            <th className="px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-muted font-semibold">
              Lap
            </th>
            <th className="px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-muted font-semibold text-right">
              km
            </th>
            <th className="px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-muted font-semibold text-right">
              Pace
            </th>
            <th className="px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-muted font-semibold text-right">
              HR
            </th>
            <th className="px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-muted font-semibold text-right">
              Time
            </th>
          </tr>
        </thead>
        <tbody>
          {laps.map((l, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-2 py-1 font-mono text-[12px] text-ink-2">{l.n}</td>
              <td className="px-2 py-1 font-mono text-[12px] -tracking-[0.01em] text-right text-ink">
                {(l.distance_m / 1000).toFixed(2)}
              </td>
              <td className="px-2 py-1 font-mono text-[12px] -tracking-[0.01em] text-right text-ink">
                {lapPace(l)}
              </td>
              <td className="px-2 py-1 font-mono text-[12px] -tracking-[0.01em] text-right text-ink">
                {l.average_heartrate ? Math.round(l.average_heartrate) : '—'}
              </td>
              <td className="px-2 py-1 font-mono text-[12px] -tracking-[0.01em] text-right text-muted">
                {fmtHms(l.moving_time_s)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
