// One-line glance of "what's planned for today" + "how I feel today" —
// rendered near the dashboard header. Numbers only, no judgment chip; the
// AI coach reading the export does the qualitative read.

export interface TodayLineSession {
  modality: string
  target_distance_km?: number | null
  target_duration_min?: number | null
  target_hr_min?: number | null
  target_hr_max?: number | null
  status: 'planned' | 'completed' | 'skipped' | null
  /** Count of prescription rows in description.exercises (strength sessions). */
  exercise_count?: number | null
}

export interface TodayLineWellness {
  sleep_hours: number | null
  morning_rhr_bpm: number | null
  hrv_ms: number | null
  mood_1_5: number | null
}

export interface TodayLineDeltas {
  /** 7-day avg RHR (excluding today). null when insufficient samples. */
  rhrAvg7d: number | null
  /** 7-day avg HRV (excluding today). null when insufficient samples. */
  hrvAvg7d: number | null
}

const MODALITY_LABEL: Record<string, string> = {
  strength_upper: 'strength upper',
  strength_lower: 'strength lower',
  strength_full: 'strength full',
  football: 'football',
  mobility: 'mobility',
  cycling: 'cycling',
  swimming: 'swimming',
  run_easy: 'easy run',
  run_tempo: 'tempo run',
  run_long: 'long run',
  run_threshold: 'threshold',
  run_vo2: 'vo2 run',
  run_race: 'race',
  run_recovery: 'recovery run',
  rest: 'rest',
  other: 'other',
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function todayWeekday(todayYmd: string): string {
  const [y, m, d] = todayYmd.split('-').map(Number)
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

function formatDelta(now: number, baseline: number): string {
  const diff = now - baseline
  const sign = diff > 0 ? '+' : ''
  return `${sign}${Math.round(diff)} vs 7d`
}

function renderSession(s: TodayLineSession): string {
  const parts: string[] = [MODALITY_LABEL[s.modality] ?? s.modality]
  if (s.target_distance_km != null) parts.push(`${s.target_distance_km} km`)
  else if (s.target_duration_min != null) parts.push(`${s.target_duration_min} min`)
  else if (s.exercise_count != null && s.exercise_count > 0) {
    // No km/duration prescription (typical strength session) — surface the
    // exercise count so the line still says something concrete.
    parts.push(`${s.exercise_count} exercise${s.exercise_count === 1 ? '' : 's'}`)
  }
  if (s.target_hr_min != null && s.target_hr_max != null) {
    parts.push(`@ HR ${s.target_hr_min}–${s.target_hr_max}`)
  }
  return parts.join(' ')
}

export interface TodayLineProps {
  todayYmd: string
  /** Today's planned/completed sessions, in order. */
  sessions: TodayLineSession[]
  /** Most recent daily_log row — today's, or yesterday's if today empty. */
  wellness: TodayLineWellness | null
  /** Date the wellness row is from (so the header can say "last night" or the actual date). */
  wellnessYmd: string | null
  deltas: TodayLineDeltas
}

export function TodayLine({
  todayYmd,
  sessions,
  wellness,
  wellnessYmd,
  deltas,
}: TodayLineProps) {
  const weekday = todayWeekday(todayYmd)

  const sessionLine =
    sessions.length === 0
      ? 'Rest day'
      : sessions.map(renderSession).join(' · ')

  const wellnessParts: string[] = []
  if (wellness?.sleep_hours != null) {
    wellnessParts.push(`slept ${wellness.sleep_hours.toFixed(1)} h`)
  }
  if (wellness?.morning_rhr_bpm != null) {
    const delta =
      deltas.rhrAvg7d != null
        ? ` (${formatDelta(wellness.morning_rhr_bpm, deltas.rhrAvg7d)})`
        : ''
    wellnessParts.push(`RHR ${wellness.morning_rhr_bpm}${delta}`)
  }
  if (wellness?.hrv_ms != null) {
    const delta =
      deltas.hrvAvg7d != null
        ? ` (${formatDelta(wellness.hrv_ms, deltas.hrvAvg7d)})`
        : ''
    wellnessParts.push(`HRV ${wellness.hrv_ms}${delta}`)
  }
  if (wellness?.mood_1_5 != null) {
    wellnessParts.push(`mood ${wellness.mood_1_5}/5`)
  }
  const wellnessLine = wellnessParts.length > 0 ? wellnessParts.join(' · ') : null
  const wellnessLabel =
    wellnessYmd === todayYmd ? 'Today' : wellnessYmd ? `Last logged ${wellnessYmd}` : null

  return (
    <section className="card bg-panel border border-border rounded-[4px] mb-4">
      <div className="px-4 py-3 flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.1em] text-muted">
            {weekday} {todayYmd}
          </span>
          <span className="font-mono text-[12px] text-ink-2">·</span>
          <span className="font-mono text-[13px] text-ink">{sessionLine}</span>
        </div>
        {wellnessLine && (
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.1em] text-muted">
              {wellnessLabel}
            </span>
            <span className="font-mono text-[12px] text-ink-2">·</span>
            <span className="font-mono text-[12px] text-ink-2">{wellnessLine}</span>
          </div>
        )}
      </div>
    </section>
  )
}
