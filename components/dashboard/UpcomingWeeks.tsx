import {
  WeekStrip,
  type WeekStripRun,
  type WeekStripSession,
} from './WeekStrip'

export interface UpcomingWeeksProps {
  // The current week's Monday (YYYY-MM-DD). Upcoming weeks start at +7, +14, +21.
  thisMonday: string
  todayYmd: string
  // All planned/completed sessions falling in any of the next 3 weeks.
  sessions: WeekStripSession[]
  // Plan week numbers for labelling (e.g. plan.weekNumber + 1, +2, +3).
  // Optional — when omitted, the label just shows the date range.
  planWeekStart?: number
  totalPlanWeeks?: number
  weeksAhead?: number
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

function formatMonthDay(ymd: string): string {
  return new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  })
}

function formatWeekLabel(mondayYmd: string, planWeek?: number, totalWeeks?: number): string {
  const sundayYmd = addDaysYmd(mondayYmd, 6)
  const range = `${formatMonthDay(mondayYmd)} – ${formatMonthDay(sundayYmd)}`
  if (planWeek == null) return range
  return totalWeeks != null
    ? `${range} · week ${planWeek}/${totalWeeks}`
    : `${range} · week ${planWeek}`
}

export function UpcomingWeeks({
  thisMonday,
  todayYmd,
  sessions,
  planWeekStart,
  totalPlanWeeks,
  weeksAhead = 3,
}: UpcomingWeeksProps) {
  // Group sessions by their week's Monday for quick lookup.
  const byWeek = new Map<string, WeekStripSession[]>()
  for (const s of sessions) {
    const ymd = s.session_at_local.slice(0, 10)
    // Find the Monday of this Ymd (UTC bucketing — sessions are stored with
    // Amsterdam local time, but we only need a stable Monday key).
    const [y, m, d] = ymd.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    const dow = dt.getUTCDay() // 0=Sun..6=Sat
    const offset = (dow + 6) % 7
    dt.setUTCDate(dt.getUTCDate() - offset)
    const wk = dt.toISOString().slice(0, 10)
    const list = byWeek.get(wk) ?? []
    list.push(s)
    byWeek.set(wk, list)
  }

  // We render the next N week-strips. Runs are always empty here because
  // future runs don't exist as Strava activities yet — they live as
  // planned training_sessions with modality=run_*.
  const noRuns: WeekStripRun[] = []
  const weeks: Array<{ monday: string; label: string; sessions: WeekStripSession[] }> = []
  for (let i = 1; i <= weeksAhead; i++) {
    const monday = addDaysYmd(thisMonday, i * 7)
    const planWeek = planWeekStart != null ? planWeekStart + i : undefined
    weeks.push({
      monday,
      label: formatWeekLabel(monday, planWeek, totalPlanWeeks),
      sessions: byWeek.get(monday) ?? [],
    })
  }

  return (
    <>
      {weeks.map(w => (
        <WeekStrip
          key={w.monday}
          title={`Week +${weeks.indexOf(w) + 1}`}
          weekLabel={w.label}
          monday={w.monday}
          todayYmd={todayYmd}
          runs={noRuns}
          sessions={w.sessions}
        />
      ))}
    </>
  )
}
