import { formatPace, type RunType } from '@/lib/run/classify'
import { avgEasyPaceMinPerKm, avgHr, pctChange, sumKm } from '@/lib/run/aggregate'

export interface WeekReviewActivity {
  id: number
  start_at: string
  distance_m: number
  moving_time_s: number
  average_heartrate: number | null
  average_speed_mps: number | null
  runType: RunType
}

export interface WeekReviewLog {
  log_date: string
  sleep_hours: number | null
  sleep_score: number | null
  energy: number | null
  habit_strength_done: boolean
  habit_no_alcohol: boolean
  habit_in_bed_on_time: boolean
}

export interface WeekReviewProps {
  weekLabel: string // e.g. "May 5 – May 11 · week 3"
  thisWeek: WeekReviewActivity[]
  lastWeek: WeekReviewActivity[]
  logs: WeekReviewLog[]
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null
  return nums.reduce((s, n) => s + n, 0) / nums.length
}

function fmtDelta(p: number | null): {
  text: string
  className: string
} | null {
  if (p === null) return null
  const sign = p > 0 ? '+' : ''
  const className = p >= 0 ? 'text-success' : 'text-warn'
  return { text: `${sign}${p.toFixed(0)}% WoW`, className }
}

function typeDotClass(type: RunType): string {
  return {
    easy: 'bg-type-easy',
    tempo: 'bg-type-tempo',
    long: 'bg-type-long',
    recovery: 'bg-type-recovery',
    race: 'bg-type-race',
  }[type]
}

export function WeekReview({ weekLabel, thisWeek, lastWeek, logs }: WeekReviewProps) {
  // The "Week review" card shows the last *completed* week.
  const review = lastWeek
  const km = sumKm(review)
  const runs = review.length
  const wow = pctChange(km, sumKm(thisWeek.length === 0 ? [] : []))
  const wowVsPrev = pctChange(
    km,
    // Compare against the week before this completed one — unavailable in
    // current data window, so show vs this-week-so-far for now.
    sumKm(thisWeek),
  )
  void wow

  const longest = review.reduce<
    WeekReviewActivity | null
  >((acc, a) => (acc && acc.distance_m > a.distance_m ? acc : a), null)
  const easyPace = avgEasyPaceMinPerKm(review)
  const easyHr = avgHr(review.filter(a => a.runType === 'easy'))

  const quality = review.filter(a => a.runType === 'tempo' || a.runType === 'long')

  const sleepAvg = avg(logs.map(l => l.sleep_hours).filter((n): n is number => n !== null))
  const sleepScoreAvg = avg(
    logs.map(l => l.sleep_score).filter((n): n is number => n !== null),
  )
  const energyAvg = avg(logs.map(l => l.energy).filter((n): n is number => n !== null))
  const habitCounts = {
    strength: logs.filter(l => l.habit_strength_done).length,
    noAlc: logs.filter(l => l.habit_no_alcohol).length,
    inBed: logs.filter(l => l.habit_in_bed_on_time).length,
  }
  const days = logs.length

  const delta = fmtDelta(wowVsPrev)

  return (
    <section className="card bg-panel border border-border rounded-[4px] mb-4">
      <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
          Week review
        </h2>
        <div className="inline-flex items-center">
          <span className="inline-flex items-center gap-2 text-[12px] text-ink-2 border border-border-2 rounded-[3px] px-2.5 py-1 bg-panel mr-2">
            Last week (complete) <span className="text-muted">▾</span>
          </span>
          <span className="font-mono text-[11px] text-muted mr-2.5 -tracking-[0.01em]">
            {weekLabel}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[1.15fr_1fr_1fr_1fr]">
        {/* RUNNING */}
        <div className="px-5 py-4 border-r border-border">
          <h3 className="m-0 mb-3 text-[10px] uppercase tracking-[0.12em] text-muted font-semibold">
            Running
          </h3>
          <Stat
            k="Volume"
            v={
              <>
                {km.toFixed(1)} km{' '}
                <span className="text-[12px] text-muted tracking-normal ml-1.5">
                  {runs} runs
                </span>
                {delta && (
                  <span className={`${delta.className} text-[13px] ml-1.5`}>
                    {delta.text}
                  </span>
                )}
              </>
            }
          />
          <Stat
            k="Longest"
            v={longest ? `${(longest.distance_m / 1000).toFixed(1)} km` : '—'}
            sub={
              longest && longest.average_speed_mps
                ? `${WEEKDAY[new Date(longest.start_at).getUTCDay()]} · ${formatPace(
                    1000 / longest.average_speed_mps / 60,
                  )} /km · ${longest.runType}`
                : null
            }
          />
          <Stat
            k="Easy-pace avg"
            v={
              <>
                {formatPace(easyPace)}
                <span className="text-[12px] text-muted tracking-normal ml-1.5">
                  /km{easyHr ? ` @ HR ${Math.round(easyHr)}` : ''}
                </span>
              </>
            }
          />
          {quality.length > 0 ? (
            <div className="mt-3">
              <div className="text-[11px] text-muted uppercase tracking-[0.06em]">
                Quality
              </div>
              <div className="text-[12px] text-ink-2 mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                {quality.map(q => (
                  <span key={q.id} className="inline-flex items-center">
                    <span
                      className={`inline-block w-[7px] h-[7px] rounded-full mr-1.5 ${typeDotClass(q.runType)}`}
                    />
                    {WEEKDAY[new Date(q.start_at).getUTCDay()]} {q.runType}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* STRENGTH — stub */}
        <div className="px-5 py-4 border-r border-border">
          <h3 className="m-0 mb-3 text-[10px] uppercase tracking-[0.12em] text-muted font-semibold">
            Strength
          </h3>
          <div className="text-[12px] text-faint leading-[1.6]">
            <p className="m-0">
              Strength tracking is not wired up yet. Coming with a{' '}
              <span className="font-mono">strength_session</span> schema.
            </p>
          </div>
        </div>

        {/* OTHER */}
        <div className="px-5 py-4 border-r border-border">
          <h3 className="m-0 mb-3 text-[10px] uppercase tracking-[0.12em] text-muted font-semibold">
            Other
          </h3>
          <Stat
            k="Football"
            sub={<span className="text-faint">no manual sessions logged</span>}
          />
          <Stat
            k="Sleep"
            v={
              sleepAvg !== null ? (
                <>
                  {sleepAvg.toFixed(1)} h
                  {sleepScoreAvg !== null && (
                    <span className="text-[12px] text-muted tracking-normal ml-1.5">
                      score {Math.round(sleepScoreAvg)} avg
                    </span>
                  )}
                </>
              ) : (
                '—'
              )
            }
          />
          <Stat
            k="Energy"
            v={
              energyAvg !== null ? (
                <>
                  {energyAvg.toFixed(1)}{' '}
                  <span className="text-[12px] text-muted tracking-normal ml-1.5">
                    / 5
                  </span>
                </>
              ) : (
                '—'
              )
            }
          />
          <Stat
            k="Habits"
            sub={
              days > 0
                ? `strength ${habitCounts.strength}/${days} · no-alc ${habitCounts.noAlc}/${days} · in-bed ${habitCounts.inBed}/${days}`
                : 'no logs this week'
            }
          />
        </div>

        {/* NEXT WEEK — stub */}
        <div className="px-5 py-4">
          <h3 className="m-0 mb-3 text-[10px] uppercase tracking-[0.12em] text-muted font-semibold">
            Next week
          </h3>
          <div className="text-[11px] text-muted uppercase tracking-[0.06em]">
            Constraints
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1 mb-3">
            <span className="font-mono text-[11px] text-faint bg-bg border border-border rounded-full px-2 py-0.5 -tracking-[0.01em]">
              no plan rows yet
            </span>
          </div>
          <div className="text-[11px] text-muted uppercase tracking-[0.06em]">
            Athlete ask
          </div>
          <div className="text-[12px] text-faint bg-bg border border-border-2 rounded-[3px] px-2.5 py-2 mt-1 leading-[1.5] min-h-16">
            <em className="text-muted not-italic">
              add a question for your coach / future-you here once the
              week_plan table exists
            </em>
          </div>
        </div>
      </div>
    </section>
  )
}

function Stat({
  k,
  v,
  sub,
}: {
  k: string
  v?: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[11px] text-muted uppercase tracking-[0.06em]">{k}</div>
      {v !== undefined && (
        <div className="font-mono text-[17px] text-ink -tracking-[0.02em] mt-px">
          {v}
        </div>
      )}
      {sub && <div className="text-[12px] text-ink-2 mt-0.5">{sub}</div>}
    </div>
  )
}
