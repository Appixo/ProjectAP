'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { LoadZone } from '@/lib/run/aggregate'

export interface WeekDatum {
  weekStart: string // YYYY-MM-DD
  km: number
  zone: LoadZone
}

const ZONE_FILL: Record<LoadZone, string> = {
  build: 'var(--color-zone-build)',
  neutral: 'var(--color-zone-neutral)',
  spike: 'var(--color-zone-spike)',
  cut: 'var(--color-zone-cut)',
  now: 'var(--color-accent-soft)',
}

export function WeeklyMileage({ data }: { data: WeekDatum[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted">No runs in this window.</p>
  }
  return (
    <div className="w-full h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 4, left: 0 }}>
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
          <Tooltip
            formatter={value => {
              const n = typeof value === 'number' ? value : Number(value)
              return [`${n.toFixed(1)} km`, 'Volume']
            }}
            labelFormatter={label => `Week of ${String(label)}`}
            contentStyle={{
              fontSize: 12,
              borderRadius: 3,
              border: '1px solid var(--color-border)',
              background: 'var(--color-panel)',
            }}
          />
          <Bar dataKey="km" isAnimationActive={false}>
            {data.map(d => (
              <Cell
                key={d.weekStart}
                fill={ZONE_FILL[d.zone]}
                stroke={d.zone === 'now' ? 'var(--color-accent)' : undefined}
                strokeWidth={d.zone === 'now' ? 1 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function WeeklyMileageLegend() {
  return (
    <div className="flex flex-wrap gap-3 items-center font-mono text-[10px] text-muted mt-1.5 -tracking-[0.01em]">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-[1px] bg-zone-build" />
        build
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-[1px] bg-zone-neutral" />
        neutral
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-[1px] bg-zone-spike" />
        spike &gt;+10%
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-[1px] bg-zone-cut" />
        cutback
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-[1px] bg-accent-soft border border-accent" />
        this week
      </span>
    </div>
  )
}
