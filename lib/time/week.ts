// Week bucketing in Europe/Amsterdam, Mon-Sun. All inputs/outputs are
// strings so we avoid the Date object's local-tz behaviour leaking in.

const APP_TIMEZONE = 'Europe/Amsterdam'

export function ymdInAmsterdam(date: Date): string {
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

export function todayInAmsterdam(): string {
  return ymdInAmsterdam(new Date())
}

export function addWeeks(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + n * 7)
  return date.toISOString().slice(0, 10)
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

// Convert an Amsterdam wall-clock string (datetime-local input value) into
// a UTC ISO instant. DST-aware via Intl.
export function amsterdamWallClockToUtcIso(local: string): string {
  const padded = local.length === 16 ? local + ':00' : local
  // Treat the wall clock string as if it were UTC, then measure how far
  // the Amsterdam projection of that instant drifts from the wall clock.
  // That delta is the local offset.
  const asUtc = new Date(padded + 'Z')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(asUtc)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value
      return acc
    }, {})
  const amsAsUtcMs = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  )
  const offsetMs = amsAsUtcMs - asUtc.getTime()
  return new Date(asUtc.getTime() - offsetMs).toISOString()
}

// Current Amsterdam wall-clock as a datetime-local string (no seconds).
export function nowAmsterdamLocalForInput(): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value
      return acc
    }, {})
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
