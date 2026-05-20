import { requireOwner } from '@/lib/auth/owner'
import { DashboardHeader } from '@/components/dashboard/Header'
import { DailyLogCard } from '@/components/dashboard/DailyLogCard'
import { SessionLogPicker } from '@/components/dashboard/SessionLogPicker'
import {
  WeekReview,
  type WeekReviewActivity,
  type WeekReviewLog,
  type WeekReviewSession,
  type WeekReviewGoals,
} from '@/components/dashboard/WeekReview'
import {
  WeekStrip,
  type WeekStripRun,
  type WeekStripSession,
  type SessionDescription,
} from '@/components/dashboard/WeekStrip'
import { PersonalBests } from '@/components/dashboard/PersonalBests'
import { Adherence } from '@/components/dashboard/Adherence'
import { bestEfforts, type ManualPersonalBest } from '@/lib/run/best_efforts'
import { RunsTable, type RunRow } from '@/components/dashboard/RunsTable'
import { Footnote } from '@/components/dashboard/Footnote'
import { WeeklyMileage, WeeklyMileageLegend, type WeekDatum } from '@/components/charts/WeeklyMileage'
import { LongestRun, type LongestDatum } from '@/components/charts/LongestRun'
import { PaceTrend, type PaceDatum } from '@/components/charts/PaceTrend'
import { Sleep, type SleepDatum } from '@/components/charts/Sleep'
import { classifyRuns, formatPace } from '@/lib/run/classify'
import { pctChange, sumKm, weeklyBuckets } from '@/lib/run/aggregate'
import { planContext } from '@/lib/time/race'
import {
  addWeeks,
  mondayOfYmd,
  todayMondayInAmsterdam,
  ymdInAmsterdam,
} from '@/lib/time/week'

const WEEKS_FOR_MILEAGE = 16
const WEEKS_FOR_LONGEST = 12
const DAYS_FOR_PACE = 90
const DAYS_FOR_SLEEP = 30

interface RawActivity {
  id: number
  start_at: string
  distance_m: number
  moving_time_s: number
  average_heartrate: number | null
  average_speed_mps: number | null
}

interface RawDailyLog {
  log_date: string
  sleep_hours: number | null
  sleep_score: number | null
  energy: number | null
  habit_strength_done: boolean
  habit_no_alcohol: boolean
  habit_in_bed_on_time: boolean
}

interface RawSession {
  id: string
  session_at: string
  session_at_local: string
  modality: string
  duration_min: number | null
  rpe: number | null
  status: 'planned' | 'completed' | 'skipped' | null
  description: SessionDescription | null
  format: string | null
  notes: string | null
  matched_activity_id: number | null
}

interface RawGoals {
  primary_goal: string
  primary_event_date: string | null
  secondary_goal: string | null
  secondary_event_date: string | null
  secondary_kind: string | null
  notes: string | null
}

function daysBetween(fromYmd: string, toYmd: string | null): number | null {
  if (!toYmd) return null
  const [fy, fm, fd] = fromYmd.split('-').map(Number)
  const [ty, tm, td] = toYmd.split('-').map(Number)
  const fromMs = Date.UTC(fy, fm - 1, fd)
  const toMs = Date.UTC(ty, tm - 1, td)
  return Math.round((toMs - fromMs) / 86400000)
}

function formatMonthDay(ymd: string): string {
  return new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  })
}

function formatWeekLabel(mondayYmd: string, planWeek?: number): string {
  const sundayYmd = addWeeks(mondayYmd, 1)
  // sunday is the Monday of the next week; subtract one day for actual Sunday
  const sun = new Date(sundayYmd + 'T00:00:00Z')
  sun.setUTCDate(sun.getUTCDate() - 1)
  const sundayLabel = sun.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  })
  const range = `${formatMonthDay(mondayYmd)} – ${sundayLabel}`
  return planWeek ? `${range} · week ${planWeek}` : range
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ weekMonday?: string }>
}) {
  const sp = await searchParams
  const { supabase, user } = await requireOwner()
  const now = new Date()
  const todayYmd = ymdInAmsterdam(now)
  const todayMonday = todayMondayInAmsterdam()
  // Browse-able strip week: ?weekMonday=YYYY-MM-DD, falls back to today's
  // Monday. Validated against a YMD shape AND realigned to the closest
  // Monday-on-or-before — protects against arbitrary date params landing
  // mid-week and producing a Mon-Sun window offset from the real week.
  const requestedWeek =
    typeof sp.weekMonday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.weekMonday)
      ? sp.weekMonday
      : todayMonday
  const stripMonday = mondayOfYmd(requestedWeek)
  const lastWeekMonday = addWeeks(todayMonday, -1)
  const sixteenWeeksAgoMonday = addWeeks(todayMonday, -(WEEKS_FOR_MILEAGE - 1))
  const sinceIso = new Date(sixteenWeeksAgoMonday + 'T00:00:00Z').toISOString()

  const sleepCutoffYmd = ymdInAmsterdam(
    new Date(now.getTime() - DAYS_FOR_SLEEP * 86400 * 1000),
  )

  const adherenceWindowStartIso = new Date(
    now.getTime() - 14 * 86400 * 1000,
  ).toISOString()
  const lastWeekStartIso = new Date(
    lastWeekMonday + 'T00:00:00Z',
  ).toISOString()
  const thisWeekStartIso = new Date(
    todayMonday + 'T00:00:00Z',
  ).toISOString()
  const stripStartIso = new Date(stripMonday + 'T00:00:00Z').toISOString()
  const stripEndIso = new Date(
    addWeeks(stripMonday, 1) + 'T00:00:00Z',
  ).toISOString()
  const nowIso = now.toISOString()

  const [
    { data: rawActivities },
    { data: allTimeRuns },
    { data: manualPbs },
    { data: sleepLogs },
    { data: lastWeekLogs },
    { data: stripSessionsRaw },
    { data: lastWeekSessionsRaw },
    { data: adherenceSessionsRaw },
    { data: goalsRaw },
  ] = await Promise.all([
    supabase
      .from('activities')
      .select(
        'id, start_at, distance_m, moving_time_s, average_heartrate, average_speed_mps',
      )
      .eq('user_id', user.id)
      .eq('type', 'Run')
      .gte('start_at', sinceIso)
      .order('start_at', { ascending: true })
      .returns<RawActivity[]>(),
    // Separate query: all-time runs for personal bests. Only the fields the
    // bestEfforts() function needs; small payload even with many years.
    supabase
      .from('activities')
      .select('id, start_at, distance_m, moving_time_s, type, source')
      .eq('user_id', user.id)
      .eq('type', 'Run')
      .order('start_at', { ascending: false })
      .returns<
        {
          id: number
          start_at: string
          distance_m: number
          moving_time_s: number
          type: string
          source: string | null
        }[]
      >(),
    // Manual personal-best entries (race results etc.). Merged with the
    // derived bests so the faster of the two wins per distance bucket.
    supabase
      .from('personal_bests')
      .select('distance_m, time_s, achieved_at, activity_id, source, event_name')
      .eq('user_id', user.id)
      .order('distance_m', { ascending: true })
      .order('time_s', { ascending: true })
      .returns<
        {
          distance_m: number
          time_s: number
          achieved_at: string
          activity_id: number | null
          source: 'logged' | 'derived' | 'synced'
          event_name: string | null
        }[]
      >(),
    supabase
      .from('daily_log')
      .select('log_date, sleep_hours')
      .eq('user_id', user.id)
      .gte('log_date', sleepCutoffYmd)
      .order('log_date', { ascending: true })
      .returns<{ log_date: string; sleep_hours: number | null }[]>(),
    supabase
      .from('daily_log')
      .select(
        'log_date, sleep_hours, sleep_score, energy, habit_strength_done, habit_no_alcohol, habit_in_bed_on_time',
      )
      .eq('user_id', user.id)
      .gte('log_date', lastWeekMonday)
      .lt('log_date', todayMonday)
      .order('log_date', { ascending: true })
      .returns<RawDailyLog[]>(),
    // Sessions for the browse-able strip week. Includes future planned rows
    // so the user can see upcoming sessions when they navigate ahead.
    supabase
      .from('training_sessions')
      .select(
        'id, session_at, session_at_local, modality, duration_min, rpe, status, description, format, notes, matched_activity_id',
      )
      .eq('user_id', user.id)
      .gte('session_at', stripStartIso)
      .lt('session_at', stripEndIso)
      .order('session_at', { ascending: true })
      .returns<RawSession[]>(),
    supabase
      .from('training_sessions')
      .select(
        'id, session_at, session_at_local, modality, duration_min, rpe, status, description, format, notes, matched_activity_id',
      )
      .eq('user_id', user.id)
      .gte('session_at', lastWeekStartIso)
      .lt('session_at', thisWeekStartIso)
      .order('session_at', { ascending: true })
      .returns<RawSession[]>(),
    // Adherence window: all sessions in the last 14 days, regardless of
    // status. Future sessions are excluded — the dashboard is logs-only.
    supabase
      .from('training_sessions')
      .select('id, session_at, status')
      .eq('user_id', user.id)
      .gte('session_at', adherenceWindowStartIso)
      .lte('session_at', nowIso)
      .returns<{ id: string; session_at: string; status: string | null }[]>(),
    supabase
      .from('goals')
      .select(
        'primary_goal, primary_event_date, secondary_goal, secondary_event_date, secondary_kind, notes',
      )
      .eq('user_id', user.id)
      .maybeSingle<RawGoals>(),
  ])

  const activities = rawActivities ?? []
  const types = classifyRuns(
    activities.map(a => ({
      id: a.id,
      start_at: a.start_at,
      distance_m: a.distance_m,
      average_speed_mps: a.average_speed_mps,
    })),
  )

  const enriched = activities.map(a => ({
    ...a,
    runType: types.get(a.id) ?? 'easy',
  }))

  const thisWeekRuns = enriched.filter(
    a => mondayOfYmd(ymdInAmsterdam(new Date(a.start_at))) === todayMonday,
  )
  const lastWeekRuns = enriched.filter(
    a => mondayOfYmd(ymdInAmsterdam(new Date(a.start_at))) === lastWeekMonday,
  )
  // Strip week's runs — independent of "this week" so the user can browse
  // forward/back without disturbing RunsTable / WeekReview / charts which
  // stay anchored to today.
  const stripWeekRuns = enriched.filter(
    a => mondayOfYmd(ymdInAmsterdam(new Date(a.start_at))) === stripMonday,
  )

  // Weekly mileage — 16 weeks
  const weeklyChartBuckets = weeklyBuckets(activities, WEEKS_FOR_MILEAGE, todayMonday)
  const weekData: WeekDatum[] = weeklyChartBuckets.map(b => ({
    weekStart: b.weekStart,
    km: b.km,
    zone: b.zone,
  }))

  // Longest run per week — last 12 weeks (drop incomplete current week from line)
  const longestData: LongestDatum[] = weeklyChartBuckets
    .slice(-WEEKS_FOR_LONGEST)
    .filter(b => b.longestM > 0 || b.weekStart !== todayMonday)
    .map(b => ({
      weekStart: b.weekStart,
      longestKm: Number((b.longestM / 1000).toFixed(2)),
    }))

  // Pace trend — last 90d + 7-run rolling
  const paceCutoffMs = now.getTime() - DAYS_FOR_PACE * 86400 * 1000
  const paceRuns = activities
    .filter(
      a =>
        new Date(a.start_at).getTime() >= paceCutoffMs &&
        a.average_speed_mps !== null &&
        a.average_speed_mps > 0,
    )
    .sort(
      (a, b) =>
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    )

  const paceData: PaceDatum[] = paceRuns.map((a, i) => {
    const win = paceRuns.slice(Math.max(0, i - 6), i + 1)
    const sumMps = win.reduce(
      (s, w) => s + (w.average_speed_mps as number),
      0,
    )
    const avgMps = sumMps / win.length
    return {
      date: ymdInAmsterdam(new Date(a.start_at)),
      pace: 1000 / (a.average_speed_mps as number) / 60,
      rolling: win.length >= 7 ? 1000 / avgMps / 60 : null,
      km: a.distance_m / 1000,
    }
  })

  const rollingNow =
    paceData.length > 0
      ? paceData[paceData.length - 1].rolling ??
        paceData[paceData.length - 1].pace
      : null
  const paceFirst = paceData.length > 0 ? paceData[0].pace : null
  const paceDeltaSec =
    paceFirst !== null && rollingNow !== null
      ? Math.round((rollingNow - paceFirst) * 60)
      : null

  // Sleep — last 30 days with non-null hours
  const sleepData: SleepDatum[] = (sleepLogs ?? [])
    .filter(
      (l): l is { log_date: string; sleep_hours: number } =>
        l.sleep_hours !== null,
    )
    .map(l => ({ log_date: l.log_date, sleep_hours: l.sleep_hours }))

  const sleepAvg30 =
    sleepData.length > 0
      ? sleepData.reduce((s, d) => s + d.sleep_hours, 0) / sleepData.length
      : null
  const sleepAvg7 = (() => {
    const last7 = sleepData.slice(-7)
    if (last7.length === 0) return null
    return last7.reduce((s, d) => s + d.sleep_hours, 0) / last7.length
  })()

  // Footers for charts
  const lastWeekKm = sumKm(lastWeekRuns)
  const thisWeekKm = sumKm(thisWeekRuns)
  const wow = pctChange(lastWeekKm, sumKm(weeklyChartBuckets.slice(-3, -2).flatMap(() => [])))
  void wow // placeholder — we already render WoW inside WeekReview

  const plan = planContext(now)
  const weekLabelReview = formatWeekLabel(lastWeekMonday, Math.max(1, plan.weekNumber - 1))
  const weekLabelThisWeek = formatWeekLabel(todayMonday, plan.weekNumber)
  // Strip label: include the in-code plan week number only when the strip
  // is anchored to the current week; for browsed weeks just show the date
  // range, since plan.weekNumber is computed relative to today not stripMonday.
  const stripIsToday = stripMonday === todayMonday
  const stripWeekLabel = stripIsToday
    ? weekLabelThisWeek
    : formatWeekLabel(stripMonday)
  const stripTitle = stripIsToday ? 'This week' : 'Week'
  const stripPrevHref = `/?weekMonday=${addWeeks(stripMonday, -1)}`
  const stripNextHref = `/?weekMonday=${addWeeks(stripMonday, 1)}`
  const stripTodayHref = stripIsToday ? null : `/`

  const runRows: RunRow[] = thisWeekRuns
    .slice()
    .sort(
      (a, b) =>
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    )
    .map(r => ({
      id: r.id,
      start_at: r.start_at,
      distance_m: r.distance_m,
      moving_time_s: r.moving_time_s,
      average_heartrate: r.average_heartrate,
      average_speed_mps: r.average_speed_mps,
      runType: r.runType,
    }))

  const reviewActivities: WeekReviewActivity[] = lastWeekRuns.map(r => ({
    id: r.id,
    start_at: r.start_at,
    distance_m: r.distance_m,
    moving_time_s: r.moving_time_s,
    average_heartrate: r.average_heartrate,
    average_speed_mps: r.average_speed_mps,
    runType: r.runType,
  }))
  const reviewThisWeek: WeekReviewActivity[] = thisWeekRuns.map(r => ({
    id: r.id,
    start_at: r.start_at,
    distance_m: r.distance_m,
    moving_time_s: r.moving_time_s,
    average_heartrate: r.average_heartrate,
    average_speed_mps: r.average_speed_mps,
    runType: r.runType,
  }))
  const reviewLogs: WeekReviewLog[] = (lastWeekLogs ?? []).map(l => ({
    log_date: l.log_date,
    sleep_hours: l.sleep_hours,
    sleep_score: l.sleep_score,
    energy: l.energy,
    habit_strength_done: l.habit_strength_done,
    habit_no_alcohol: l.habit_no_alcohol,
    habit_in_bed_on_time: l.habit_in_bed_on_time,
  }))

  const stripSessionsList = stripSessionsRaw ?? []
  const lastWeekSessions = lastWeekSessionsRaw ?? []

  // Adherence in the last 14 days. Planned-but-not-completed = missed.
  let completed = 0
  let skipped = 0
  let missed = 0
  for (const s of adherenceSessionsRaw ?? []) {
    const status = s.status ?? 'completed'
    if (status === 'completed') completed += 1
    else if (status === 'skipped') skipped += 1
    else if (status === 'planned') missed += 1
  }

  // Personal bests computed across all-time runs. bestEfforts() accepts the
  // ActivityForDerived shape; we only need id/start_at/distance_m/moving_time_s
  // /type/source — fill the remaining fields with safe defaults.
  const manualPbList: ManualPersonalBest[] = (manualPbs ?? []).map(m => ({
    distance_m: m.distance_m,
    time_s: m.time_s,
    achieved_at: m.achieved_at,
    activity_id: m.activity_id,
    source: m.source,
    event_name: m.event_name,
  }))
  const personalBests = bestEfforts(
    (allTimeRuns ?? []).map(a => ({
      id: a.id,
      start_at: a.start_at,
      distance_m: a.distance_m,
      moving_time_s: a.moving_time_s,
      type: a.type,
      has_heartrate: false,
      average_heartrate: null,
      max_heartrate: null,
      average_speed_mps: null,
      source: a.source,
    })),
    manualPbList,
  )
  // Dedup planned-run matches: when a session has matched_activity_id set,
  // hide that activity from the runs strip (the session already represents
  // it) and attach the run's actuals to the session for the popover.
  const matchedActivityIds = new Set(
    stripSessionsList
      .filter(s => s.matched_activity_id != null)
      .map(s => s.matched_activity_id as number),
  )
  const runById = new Map(stripWeekRuns.map(r => [r.id, r]))

  const stripRuns: WeekStripRun[] = stripWeekRuns
    .filter(r => !matchedActivityIds.has(r.id))
    .map(r => ({
      id: r.id,
      start_at: r.start_at,
      distance_m: r.distance_m,
      moving_time_s: r.moving_time_s,
      runType: r.runType,
    }))
  const stripSessions: WeekStripSession[] = stripSessionsList
    .filter(s => (s.status ?? 'completed') !== 'skipped')
    .map(s => {
      const matched =
        s.matched_activity_id != null ? runById.get(s.matched_activity_id) : undefined
      return {
        id: s.id,
        session_at_local: s.session_at_local,
        modality: s.modality,
        duration_min: s.duration_min,
        rpe: s.rpe,
        status: s.status,
        description: s.description,
        format: s.format,
        notes: s.notes,
        matched_run: matched
          ? {
              id: matched.id,
              start_at: matched.start_at,
              distance_m: matched.distance_m,
              moving_time_s: matched.moving_time_s,
              runType: matched.runType,
            }
          : null,
      }
    })

  const reviewSessions: WeekReviewSession[] = lastWeekSessions.map(s => ({
    id: s.id,
    session_at_local: s.session_at_local,
    modality: s.modality,
    duration_min: s.duration_min,
    rpe: s.rpe,
  }))

  const goalsForReview: WeekReviewGoals | null = goalsRaw
    ? {
        primary_goal: goalsRaw.primary_goal,
        primary_event_date: goalsRaw.primary_event_date,
        days_to_primary: daysBetween(todayYmd, goalsRaw.primary_event_date),
        secondary_goal: goalsRaw.secondary_goal,
        secondary_event_date: goalsRaw.secondary_event_date,
        days_to_secondary: daysBetween(todayYmd, goalsRaw.secondary_event_date),
        secondary_kind: goalsRaw.secondary_kind,
        notes: goalsRaw.notes,
      }
    : null

  return (
    <div className="max-w-[1200px] mx-auto px-7 pt-8 pb-20">
      <DashboardHeader />

      {/* inputs row */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <DailyLogCard />
        <SessionLogPicker todayYmd={todayYmd} />
      </section>

      {/* personal bests across all time */}
      <PersonalBests best={personalBests} />

      {/* adherence — last 14 days planned vs completed */}
      <Adherence
        completed={completed}
        skipped={skipped}
        missed={missed}
      />

      {/* strip — cross-modal day grid; browse-able via ?weekMonday */}
      <WeekStrip
        title={stripTitle}
        weekLabel={stripWeekLabel}
        monday={stripMonday}
        todayYmd={todayYmd}
        runs={stripRuns}
        sessions={stripSessions}
        prevHref={stripPrevHref}
        nextHref={stripNextHref}
        todayHref={stripTodayHref}
      />

      {/* week review */}
      <WeekReview
        weekLabel={weekLabelReview}
        thisWeek={reviewThisWeek}
        lastWeek={reviewActivities}
        logs={reviewLogs}
        sessions={reviewSessions}
        goals={goalsForReview}
      />

      {/* trend strip — 2x2 */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <ChartCard
          title="Weekly mileage"
          meta={`${WEEKS_FOR_MILEAGE} weeks · km · Mon–Sun`}
          foot={
            <div className="flex justify-between font-mono text-[10px] text-muted mt-1">
              <span>last wk {lastWeekKm.toFixed(1)} km</span>
              <span>this wk {thisWeekKm.toFixed(1)} km (so far)</span>
            </div>
          }
        >
          <WeeklyMileage data={weekData} />
          <WeeklyMileageLegend />
        </ChartCard>

        <ChartCard
          title="Longest run / week"
          meta={`${WEEKS_FOR_LONGEST} weeks · km`}
          foot={
            <div className="flex justify-between font-mono text-[10px] text-muted mt-1">
              <span>
                {longestData.length > 0
                  ? `last ${longestData[longestData.length - 1].longestKm.toFixed(1)} km`
                  : '—'}
              </span>
              <span>
                {longestData.length > 0
                  ? `${(30 - longestData[longestData.length - 1].longestKm).toFixed(1)} km gap to target`
                  : 'marathon target ≥ 30'}
              </span>
            </div>
          }
        >
          <LongestRun data={longestData} />
        </ChartCard>

        <ChartCard
          title="Pace trend"
          meta={`${DAYS_FOR_PACE} days · min/km · ↑ = faster`}
          foot={
            <div className="flex justify-between font-mono text-[10px] text-muted mt-1">
              <span>
                {rollingNow !== null
                  ? `7-run avg ${formatPace(rollingNow)} /km`
                  : '—'}
              </span>
              <span>
                {paceDeltaSec !== null
                  ? `${paceDeltaSec >= 0 ? '+' : ''}${paceDeltaSec}s vs ${DAYS_FOR_PACE}d ago`
                  : ''}
              </span>
            </div>
          }
        >
          <PaceTrend data={paceData} />
        </ChartCard>

        <ChartCard
          title="Sleep"
          meta={`${DAYS_FOR_SLEEP} days · hours`}
          foot={
            <div className="flex justify-between font-mono text-[10px] text-muted mt-1">
              <span>
                {sleepAvg30 !== null
                  ? `${DAYS_FOR_SLEEP}d avg ${sleepAvg30.toFixed(1)} h`
                  : '—'}
              </span>
              <span>
                {sleepAvg7 !== null
                  ? `last 7 days ${sleepAvg7.toFixed(1)} h`
                  : ''}
              </span>
            </div>
          }
        >
          <Sleep data={sleepData} />
        </ChartCard>
      </section>

      {/* this week's runs */}
      <RunsTable weekLabel={weekLabelThisWeek} rows={runRows} />

      <Footnote />
    </div>
  )
}

function ChartCard({
  title,
  meta,
  children,
  foot,
}: {
  title: string
  meta: string
  children: React.ReactNode
  foot?: React.ReactNode
}) {
  return (
    <div className="card bg-panel border border-border rounded-[4px]">
      <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
          {title}
        </h2>
        <span className="font-mono text-[11px] text-muted -tracking-[0.01em]">
          {meta}
        </span>
      </div>
      <div className="px-4 pt-3.5 pb-3">
        {children}
        {foot}
      </div>
    </div>
  )
}
