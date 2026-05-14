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

export interface PaceDatum {
  date: string // YYYY-MM-DD in Europe/Amsterdam
  pace: number // minutes per km, decimal
  km: number
}

function formatPace(decimalMinutes: number): string {
  if (!isFinite(decimalMinutes) || decimalMinutes <= 0) return '—'
  const m = Math.floor(decimalMinutes)
  const s = Math.round((decimalMinutes - m) * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function PaceTrend({ data }: { data: PaceDatum[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-neutral-600">No runs in this window.</p>
  }
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis
            dataKey="date"
            tickFormatter={s => s.slice(5)}
            fontSize={12}
            stroke="#737373"
          />
          <YAxis
            reversed
            domain={['dataMin - 0.2', 'dataMax + 0.2']}
            tickFormatter={(v: number) => formatPace(v)}
            fontSize={12}
            stroke="#737373"
            width={56}
          />
          <Tooltip
            formatter={(value, _name, item) => {
              const n = typeof value === 'number' ? value : Number(value)
              const km = (item?.payload as PaceDatum | undefined)?.km
              return [
                `${formatPace(n)} /km · ${km ? km.toFixed(2) : '—'} km`,
                'Pace',
              ]
            }}
            labelFormatter={label => String(label ?? '')}
            contentStyle={{
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid #e5e5e5',
            }}
          />
          <Line
            type="monotone"
            dataKey="pace"
            stroke="#fc4c02"
            strokeWidth={2}
            dot={{ r: 2.5, stroke: '#fc4c02', fill: '#fc4c02' }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
