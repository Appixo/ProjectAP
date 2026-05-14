// Week bucketing in Europe/Amsterdam, Mon-Sun. All inputs/outputs are
// strings so we avoid the Date object's local-tz behaviour leaking in.

const APP_TIMEZONE = 'Europe/Amsterdam'

function ymdInAmsterdam(date: Date): string {
  // 'en-CA' formats year-month-day as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function mondayOfYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dow = date.getUTCDay() // 0=Sun..6=Sat
  const offset = (dow + 6) % 7 // 0 if Mon, 6 if Sun
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}

export function weekStartFromStartAt(startAtIso: string): string {
  return mondayOfYmd(ymdInAmsterdam(new Date(startAtIso)))
}

export function todayMondayInAmsterdam(): string {
  return mondayOfYmd(ymdInAmsterdam(new Date()))
}

export function addWeeks(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + n * 7)
  return date.toISOString().slice(0, 10)
}
