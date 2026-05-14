'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface SleepDatum {
  log_date: string // YYYY-MM-DD
  sleep_hours: number
}

const TARGET_HOURS = 7

export function Sleep({ data }: { data: SleepDatum[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted">No sleep logs in this window.</p>
    )
  }
  return (
    <div className="w-full h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
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
            domain={[5, 9]}
            ticks={[5, 6, 7, 8, 9]}
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
            formatter={value => {
              const n = typeof value === 'number' ? value : Number(value)
              return [`${n.toFixed(1)} h`, 'Sleep']
            }}
            labelFormatter={label => String(label ?? '')}
            contentStyle={{
              fontSize: 12,
              borderRadius: 3,
              border: '1px solid var(--color-border)',
              background: 'var(--color-panel)',
            }}
          />
          <Bar dataKey="sleep_hours" isAnimationActive={false}>
            {data.map(d => (
              <Cell
                key={d.log_date}
                fill={
                  d.sleep_hours < TARGET_HOURS
                    ? 'var(--color-faint)'
                    : 'var(--color-ink)'
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
