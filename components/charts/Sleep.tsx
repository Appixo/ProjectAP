'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface SleepDatum {
  log_date: string // YYYY-MM-DD
  /** Logged hours; null for days with no log (rendered as a gap). */
  sleep_hours: number | null
  /** 7-day rolling mean ending on this day; null when window has <3 samples. */
  rolling: number | null
}

const TARGET_HOURS = 7

export function Sleep({ data }: { data: SleepDatum[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted">No sleep logs in this window.</p>
  }
  return (
    <div className="w-full h-40">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid
            vertical={false}
            stroke="oklch(0.92 0.005 85)"
            strokeWidth={1}
          />
          <XAxis
            dataKey="log_date"
            tickFormatter={s => s.slice(5)}
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
            domain={[4, 10]}
            ticks={[4, 5, 6, 7, 8, 9, 10]}
            tick={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fill: 'var(--color-muted)',
            }}
            tickLine={false}
            axisLine={false}
            width={24}
          />
          <ReferenceLine
            y={TARGET_HOURS}
            stroke="var(--color-accent)"
            strokeDasharray="3 3"
            strokeOpacity={0.6}
            label={{
              value: '7h target',
              position: 'insideTopRight',
              fontSize: 9,
              fontFamily: 'var(--font-mono)',
              fill: 'var(--color-accent)',
              fillOpacity: 0.85,
            }}
          />
          <Tooltip
            formatter={(value, name) => {
              const n = typeof value === 'number' ? value : Number(value)
              const label = name === 'rolling' ? '7d avg' : 'Sleep'
              return [`${n.toFixed(1)} h`, label]
            }}
            labelFormatter={label => String(label ?? '')}
            contentStyle={{
              fontSize: 12,
              borderRadius: 3,
              border: '1px solid var(--color-border)',
              background: 'var(--color-panel)',
            }}
          />
          {/* daily raw — line breaks at null days, dot at each logged value */}
          <Line
            type="monotone"
            dataKey="sleep_hours"
            stroke="var(--color-faint)"
            strokeWidth={1.2}
            dot={{ r: 2, fill: 'var(--color-ink)', stroke: 'var(--color-ink)' }}
            isAnimationActive={false}
            connectNulls={false}
          />
          {/* 7-day rolling — smooth read of the trend */}
          <Line
            type="monotone"
            dataKey="rolling"
            stroke="var(--color-accent)"
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
