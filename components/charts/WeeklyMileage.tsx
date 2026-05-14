'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface WeekDatum {
  week: string // ISO date of the Monday (YYYY-MM-DD)
  km: number
}

export function WeeklyMileage({ data }: { data: WeekDatum[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-neutral-600">No runs in this window.</p>
  }
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis
            dataKey="week"
            tickFormatter={s => s.slice(5)}
            fontSize={12}
            stroke="#737373"
          />
          <YAxis
            unit=" km"
            fontSize={12}
            stroke="#737373"
            width={56}
          />
          <Tooltip
            formatter={value => {
              const n = typeof value === 'number' ? value : Number(value)
              return [`${n.toFixed(1)} km`, 'Distance']
            }}
            labelFormatter={label => `Week of ${String(label)}`}
            contentStyle={{
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid #e5e5e5',
            }}
          />
          <Bar dataKey="km" fill="#fc4c02" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
