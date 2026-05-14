import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ActivityTable, type ActivityRow } from '@/components/ActivityTable'
import {
  WeeklyMileage,
  type WeekDatum,
} from '@/components/charts/WeeklyMileage'
import {
  PaceTrend,
  type PaceDatum,
} from '@/components/charts/PaceTrend'
import {
  SleepEnergy,
  type SleepEnergyDatum,
} from '@/components/charts/SleepEnergy'
import {
  addWeeks,
  todayMondayInAmsterdam,
  weekStartFromStartAt,
} from '@/lib/time/week'

const WEEKS_SHOWN = 16
const PACE_WINDOW_DAYS = 90
const RECENT_LIMIT = 20

function ymdInAmsterdam(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()

  const sinceMonday = addWeeks(todayMondayInAmsterdam(), -(WEEKS_SHOWN - 1))
  const sinceWeekIso = new Date(sinceMonday + 'T00:00:00Z').toISOString()

  const paceSince = new Date()
  paceSince.setUTCDate(paceSince.getUTCDate() - PACE_WINDOW_DAYS)

  const { data: chartActivities } = await supabase
    .from('activities')
    .select('start_at, distance_m, average_speed_mps')
    .eq('type', 'Run')
    .gte('start_at', sinceWeekIso)
    .order('start_at', { ascending: true })

  const { data: recent } = await supabase
    .from('activities')
    .select(
      'id, name, start_at, distance_m, moving_time_s, average_heartrate, average_speed_mps',
    )
    .eq('type', 'Run')
    .order('start_at', { ascending: false })
    .limit(RECENT_LIMIT)

  const { data: logs } = await supabase
    .from('daily_log')
    .select('log_date, sleep_hours, energy, sleep_score')
    .not('sleep_hours', 'is', null)
    .not('energy', 'is', null)
    .order('log_date', { ascending: false })
    .limit(180)

  // Weekly mileage — bucket by Mon-Sun in Europe/Amsterdam, fill empty weeks.
  const weeklyMap = new Map<string, number>()
  for (const a of chartActivities ?? []) {
    const week = weekStartFromStartAt(a.start_at)
    weeklyMap.set(week, (weeklyMap.get(week) ?? 0) + a.distance_m / 1000)
  }
  const weeks: WeekDatum[] = []
  for (let i = 0; i < WEEKS_SHOWN; i++) {
    const week = addWeeks(sinceMonday, i)
    weeks.push({ week, km: Number((weeklyMap.get(week) ?? 0).toFixed(2)) })
  }

  const sleepEnergyData: SleepEnergyDatum[] = (logs ?? [])
    .filter(
      (l): l is {
        log_date: string
        sleep_hours: number
        energy: number
        sleep_score: number | null
      } => l.sleep_hours !== null && l.energy !== null,
    )
    .map(l => ({
      log_date: l.log_date,
      sleep_hours: l.sleep_hours,
      energy: l.energy,
      sleep_score: l.sleep_score,
    }))

  // Pace trend — last 90 days, one point per run.
  const paceCutoff = paceSince.getTime()
  const paceData: PaceDatum[] = (chartActivities ?? [])
    .filter(a => {
      const t = new Date(a.start_at).getTime()
      return (
        t >= paceCutoff &&
        a.average_speed_mps !== null &&
        a.average_speed_mps > 0
      )
    })
    .map(a => ({
      date: ymdInAmsterdam(new Date(a.start_at)),
      pace: 1000 / (a.average_speed_mps as number) / 60,
      km: a.distance_m / 1000,
    }))

  return (
    <div className="space-y-8 max-w-5xl">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Weekly mileage <span className="text-sm text-neutral-500 font-normal">(last {WEEKS_SHOWN} weeks)</span>
        </h2>
        <WeeklyMileage data={weeks} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Pace trend <span className="text-sm text-neutral-500 font-normal">(last {PACE_WINDOW_DAYS} days, min/km)</span>
        </h2>
        <PaceTrend data={paceData} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Sleep vs energy <span className="text-sm text-neutral-500 font-normal">(dot size = sleep score)</span>
        </h2>
        <SleepEnergy data={sleepEnergyData} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recent runs</h2>
        <ActivityTable rows={(recent ?? []) as ActivityRow[]} />
      </section>
    </div>
  )
}
