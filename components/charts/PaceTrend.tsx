'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatPace } from '@/lib/run/classify'

export interface PaceDatum {
  date: string // YYYY-MM-DD
  pace: number // min/km, decimal
  rolling: number | null // 7-run rolling avg
  km: number
}

export function PaceTrend({ data }: { data: PaceDatum[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted">No runs in this window.</p>
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
            dataKey="date"
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
            reversed
            domain={['dataMin - 0.2', 'dataMax + 0.2']}
            tickFormatter={(v: number) => formatPace(v)}
            tick={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fill: 'var(--color-muted)',
            }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            formatter={(value, name, item) => {
              const n = typeof value === 'number' ? value : Number(value)
              const km = (item?.payload as PaceDatum | undefined)?.km
              const label = name === 'rolling' ? '7-run avg' : 'Pace'
              return [
                `${formatPace(n)} /km${km ? ` · ${km.toFixed(2)} km` : ''}`,
                label,
              ]
            }}
            labelFormatter={label => String(label ?? '')}
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
            dataKey="pace"
            stroke="var(--color-ink)"
            strokeWidth={1.2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
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
