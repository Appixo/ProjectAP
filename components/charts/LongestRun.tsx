'use client'

import {
  CartesianGrid,
  Dot,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface LongestDatum {
  weekStart: string // YYYY-MM-DD
  longestKm: number
}

interface AccentDotProps {
  cx?: number
  cy?: number
  index?: number
  totalPoints: number
}

function LastPointDot({ cx, cy, index, totalPoints }: AccentDotProps) {
  if (cx === undefined || cy === undefined) return null
  const isLast = index === totalPoints - 1
  return (
    <Dot
      cx={cx}
      cy={cy}
      r={isLast ? 3.5 : 2.5}
      fill={isLast ? 'var(--color-accent)' : 'var(--color-ink)'}
      stroke={isLast ? 'var(--color-accent)' : 'var(--color-ink)'}
    />
  )
}

export function LongestRun({ data }: { data: LongestDatum[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted">Not enough data yet.</p>
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
            dataKey="weekStart"
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
            domain={[0, (dataMax: number) => Math.max(5, Math.ceil((dataMax + 2) / 5) * 5)]}
            allowDecimals={false}
            tick={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fill: 'var(--color-muted)',
            }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <ReferenceLine
            y={30}
            stroke="var(--color-muted)"
            strokeDasharray="3 3"
            label={{
              value: 'marathon target ≥ 30',
              position: 'insideTopRight',
              fontSize: 9,
              fontFamily: 'var(--font-mono)',
              fill: 'var(--color-muted)',
            }}
          />
          <Tooltip
            formatter={value => {
              const n = typeof value === 'number' ? value : Number(value)
              return [`${n.toFixed(1)} km`, 'Longest']
            }}
            labelFormatter={label => `Week of ${String(label)}`}
            contentStyle={{
              fontSize: 12,
              borderRadius: 3,
              border: '1px solid var(--color-border)',
              background: 'var(--color-panel)',
              color: 'var(--color-ink)',
            }}
            labelStyle={{ color: 'var(--color-muted)' }}
            itemStyle={{ color: 'var(--color-ink)' }}
          />
          <Line
            type="monotone"
            dataKey="longestKm"
            stroke="var(--color-ink)"
            strokeWidth={1.5}
            isAnimationActive={false}
            dot={dotProps => (
              <LastPointDot {...dotProps} totalPoints={data.length} />
            )}
            activeDot={{ r: 4, fill: 'var(--color-accent)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
