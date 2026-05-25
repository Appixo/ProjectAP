'use client'

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// Consistency chart: weekly running volume over a 12-week past window plus
// 4 projected weeks. Past weeks render as stacked easy/threshold+ km from
// completed activities; projected weeks render as hollow dashed bars showing
// only the planned long-run km (the trajectory the seed block puts in place).
//
// Gaps are honest: a past week with zero runs has null fields and recharts
// renders no bar at all (not a zero-height stub).

export interface ConsistencyDatum {
  weekStart: string // YYYY-MM-DD (Monday)
  easyKm: number | null // null = no runs that week (gap)
  thresholdPlusKm: number | null
  projectedKm: number | null // populated only for future weeks
  rolling4wk: number | null // total km, 4-week rolling avg; null for projected weeks
  /** True for the current (in-progress) week. Used for axis label highlight. */
  isCurrent: boolean
}

interface TooltipPayloadItem {
  dataKey?: string | number
  name?: string
  value?: number | string | null
  color?: string
}

interface ChartTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string | number
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const lookup = new Map<string, number>()
  for (const p of payload) {
    if (typeof p.value === 'number' && p.dataKey) {
      lookup.set(String(p.dataKey), p.value)
    }
  }
  const easy = lookup.get('easyKm')
  const thr = lookup.get('thresholdPlusKm')
  const proj = lookup.get('projectedKm')
  const rolling = lookup.get('rolling4wk')
  const total =
    proj != null ? proj : (easy ?? 0) + (thr ?? 0)
  return (
    <div
      className="font-mono text-[11px] border border-border bg-panel rounded-[3px] px-2 py-1.5 space-y-0.5"
      style={{ minWidth: 140 }}
    >
      <div className="text-ink-2">Week of {String(label)}</div>
      {proj != null ? (
        <div className="text-faint">planned long {proj.toFixed(1)} km</div>
      ) : (
        <>
          <div className="text-ink">{total.toFixed(1)} km total</div>
          <div className="text-muted">easy {(easy ?? 0).toFixed(1)} km</div>
          <div className="text-muted">tempo+ {(thr ?? 0).toFixed(1)} km</div>
          {rolling != null && (
            <div className="text-muted">4wk avg {rolling.toFixed(1)} km</div>
          )}
        </>
      )}
    </div>
  )
}

export function ConsistencyChart({ data }: { data: ConsistencyDatum[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted">No data yet.</p>
  }
  return (
    <div className="w-full h-44">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 4, left: 0 }}>
          <CartesianGrid
            vertical={false}
            stroke="oklch(0.92 0.005 85)"
            strokeWidth={1}
          />
          <XAxis
            dataKey="weekStart"
            tickFormatter={s => String(s).slice(5)}
            interval="preserveStartEnd"
            tick={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fill: 'var(--color-muted)',
            }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-muted)' }}
          />
          <YAxis
            tick={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fill: 'var(--color-muted)',
            }}
            tickLine={false}
            axisLine={false}
            width={28}
            unit=""
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: 'var(--color-accent-soft)' }}
          />
          <Bar
            dataKey="easyKm"
            stackId="actual"
            fill="var(--color-type-easy)"
            isAnimationActive={false}
          />
          <Bar
            dataKey="thresholdPlusKm"
            stackId="actual"
            fill="var(--color-type-tempo)"
            isAnimationActive={false}
          />
          <Bar
            dataKey="projectedKm"
            fill="transparent"
            stroke="var(--color-faint)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            isAnimationActive={false}
          />
          <Line
            dataKey="rolling4wk"
            type="monotone"
            stroke="var(--color-muted)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ConsistencyLegend() {
  return (
    <div className="flex flex-wrap gap-3 items-center font-mono text-[10px] text-muted mt-1.5 -tracking-[0.01em]">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-[1px] bg-type-easy" />
        easy
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-[1px] bg-type-tempo" />
        tempo+
      </span>
      <span className="inline-flex items-center gap-1">
        <span
          className="inline-block w-2.5 h-2.5 rounded-[1px]"
          style={{
            border: '1.5px dashed var(--color-faint)',
            background: 'transparent',
          }}
        />
        planned long
      </span>
      <span className="inline-flex items-center gap-1">
        <span
          className="inline-block w-3 h-[2px]"
          style={{
            borderTop: '1.5px dashed var(--color-muted)',
          }}
        />
        4wk avg
      </span>
    </div>
  )
}

export function ConsistencyStats({
  avgKm,
  weeksWithRun,
  totalWeeks,
}: {
  avgKm: number
  weeksWithRun: number
  totalWeeks: number
}) {
  return (
    <div className="grid grid-cols-2 gap-2 mb-2 font-mono text-[11px]">
      <div className="border border-border rounded-[3px] px-2.5 py-2">
        <div className="text-[9px] uppercase tracking-[0.1em] text-muted">
          {totalWeeks}wk avg
        </div>
        <div className="text-ink text-[14px] mt-0.5 -tracking-[0.02em]">
          {avgKm.toFixed(1)} <span className="text-muted text-[10px]">km/wk</span>
        </div>
      </div>
      <div className="border border-border rounded-[3px] px-2.5 py-2">
        <div className="text-[9px] uppercase tracking-[0.1em] text-muted">
          weeks with a run
        </div>
        <div className="text-ink text-[14px] mt-0.5 -tracking-[0.02em]">
          {weeksWithRun}
          <span className="text-muted text-[10px]"> / {totalWeeks}</span>
        </div>
      </div>
    </div>
  )
}
