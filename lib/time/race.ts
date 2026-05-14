import { mondayOfYmd, ymdInAmsterdam } from './week'

// Race details for the marathon target. Single source of truth.
export const RACE = {
  name: 'Marathon',
  date: '2026-11-01', // race day
  longDateLabel: 'Nov 1, 2026',
} as const

// Plan begins on this Monday. Update when an actual training plan is locked.
// Until a training_plan table exists, this is a constant so plan-week display
// is deterministic and forward-shifting on its own.
const PLAN_START_MONDAY = '2026-04-20'
const PLAN_TOTAL_WEEKS = 24

function daysBetweenYmd(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  )
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  )
  return Math.round((b - a) / (86400 * 1000))
}

export function daysToRace(now: Date = new Date()): number {
  const todayYmd = ymdInAmsterdam(now)
  return Math.max(0, daysBetweenYmd(todayYmd, RACE.date))
}

export interface PlanContext {
  phase: string
  weekNumber: number
  totalWeeks: number
}

export function planContext(now: Date = new Date()): PlanContext {
  const todayMonday = mondayOfYmd(ymdInAmsterdam(now))
  const deltaDays = daysBetweenYmd(PLAN_START_MONDAY, todayMonday)
  const rawWeek = Math.floor(deltaDays / 7) + 1
  const weekNumber = Math.max(1, Math.min(PLAN_TOTAL_WEEKS, rawWeek))

  let phase = 'Base phase'
  if (weekNumber > PLAN_TOTAL_WEEKS - 4) phase = 'Taper'
  else if (weekNumber > 8) phase = 'Build phase'

  return { phase, weekNumber, totalWeeks: PLAN_TOTAL_WEEKS }
}

export function shortDayDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
    .format(now)
    .replace(',', ' ·')
}
