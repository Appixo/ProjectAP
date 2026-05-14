'use client'

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'

export interface SleepEnergyDatum {
  sleep_hours: number
  energy: number
  sleep_score: number | null
  log_date: string
}

export function SleepEnergy({ data }: { data: SleepEnergyDatum[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        No daily logs yet — add some on the Log page.
      </p>
    )
  }
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis
            type="number"
            dataKey="sleep_hours"
            domain={['dataMin - 0.5', 'dataMax + 0.5']}
            tickFormatter={(v: number) => `${v}h`}
            fontSize={12}
            stroke="#737373"
          />
          <YAxis
            type="number"
            dataKey="energy"
            domain={[0.5, 5.5]}
            ticks={[1, 2, 3, 4, 5]}
            fontSize={12}
            stroke="#737373"
            width={32}
          />
          <ZAxis
            type="number"
            dataKey="sleep_score"
            range={[40, 200]}
            name="Sleep score"
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            formatter={(value, name) => {
              const n = typeof value === 'number' ? value : Number(value)
              if (name === 'sleep_hours') return [`${n.toFixed(1)} h`, 'Sleep']
              if (name === 'energy') return [`${n}/5`, 'Energy']
              if (name === 'sleep_score') return [n ? `${n}` : '—', 'Score']
              return [String(value), String(name)]
            }}
            labelFormatter={(_, payload) => {
              const d = (payload?.[0]?.payload as SleepEnergyDatum | undefined)
                ?.log_date
              return d ?? ''
            }}
            contentStyle={{
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid #e5e5e5',
            }}
          />
          <Scatter data={data} fill="#fc4c02" fillOpacity={0.7} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
