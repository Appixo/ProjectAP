// 23-week marathon-prep progression. Source of truth for what *should*
// be planned each week. Only the next 2-4 weeks ever live in the DB as
// training_sessions rows; the rest is read from here to render previews.
//
// Anchored on Mon 2026-05-25 → Sun 2026-11-01. Long-run targets reflect
// the 2026-05 training read: ≥20 km by mid-June, ≥25 km by early July,
// peak at wk 16 (36 km), 3-week taper to race wk 23.

export interface WeekSpec {
  wk: number
  mondayYmd: string
  longKm: number
  isDown: boolean
  isRace: boolean
  reason: string
}

export const PROGRESSION: WeekSpec[] = [
  { wk: 1, mondayYmd: '2026-05-25', longKm: 16, isDown: false, isRace: false, reason: 'rebuild from last week 14' },
  { wk: 2, mondayYmd: '2026-06-01', longKm: 18, isDown: false, isRace: false, reason: 'step +2' },
  { wk: 3, mondayYmd: '2026-06-08', longKm: 20, isDown: false, isRace: false, reason: 'mid-June ≥20 target' },
  { wk: 4, mondayYmd: '2026-06-15', longKm: 22, isDown: false, isRace: false, reason: 'step +2' },
  { wk: 5, mondayYmd: '2026-06-22', longKm: 24, isDown: false, isRace: false, reason: 'step +2' },
  { wk: 6, mondayYmd: '2026-06-29', longKm: 20, isDown: true, isRace: false, reason: 'down −17%' },
  { wk: 7, mondayYmd: '2026-07-06', longKm: 26, isDown: false, isRace: false, reason: 'early-July ≥25 target' },
  { wk: 8, mondayYmd: '2026-07-13', longKm: 28, isDown: false, isRace: false, reason: 'step +2' },
  { wk: 9, mondayYmd: '2026-07-20', longKm: 30, isDown: false, isRace: false, reason: 'first 30; start by 07:00' },
  { wk: 10, mondayYmd: '2026-07-27', longKm: 24, isDown: true, isRace: false, reason: 'down −20%' },
  { wk: 11, mondayYmd: '2026-08-03', longKm: 32, isDown: false, isRace: false, reason: 'step +2' },
  { wk: 12, mondayYmd: '2026-08-10', longKm: 34, isDown: false, isRace: false, reason: 'football season starts 8/11' },
  { wk: 13, mondayYmd: '2026-08-17', longKm: 26, isDown: true, isRace: false, reason: 'down −24%' },
  { wk: 14, mondayYmd: '2026-08-24', longKm: 35, isDown: false, isRace: false, reason: 'step +1' },
  { wk: 15, mondayYmd: '2026-08-31', longKm: 32, isDown: false, isRace: false, reason: 'step −3 (mini-down)' },
  { wk: 16, mondayYmd: '2026-09-07', longKm: 36, isDown: false, isRace: false, reason: 'peak' },
  { wk: 17, mondayYmd: '2026-09-14', longKm: 28, isDown: true, isRace: false, reason: 'down −22%' },
  { wk: 18, mondayYmd: '2026-09-21', longKm: 34, isDown: false, isRace: false, reason: 'post-peak hold' },
  { wk: 19, mondayYmd: '2026-09-28', longKm: 30, isDown: false, isRace: false, reason: 'taper prelude' },
  { wk: 20, mondayYmd: '2026-10-05', longKm: 26, isDown: false, isRace: false, reason: 'taper opens' },
  { wk: 21, mondayYmd: '2026-10-12', longKm: 22, isDown: false, isRace: false, reason: 'taper' },
  { wk: 22, mondayYmd: '2026-10-19', longKm: 16, isDown: false, isRace: false, reason: 'taper' },
  { wk: 23, mondayYmd: '2026-10-26', longKm: 0, isDown: false, isRace: true, reason: 'race week — marathon Sun 2026-11-01' },
]

export const MARATHON_DATE = '2026-11-01'
export const PLAN_FIRST_MONDAY = '2026-05-25'

export type PlanModality =
  | 'rest'
  | 'run_easy'
  | 'run_threshold'
  | 'run_long'
  | 'run_recovery'
  | 'run_race'
  | 'football'
  | 'strength_upper'
  | 'strength_lower'

export interface DayTemplate {
  dow: 1 | 2 | 3 | 4 | 5 | 6 | 7  // Mon=1..Sun=7
  hourLocal: number
  minuteLocal: number
  modality: PlanModality
  // Fixed-distance overrides (used for race-week and recovery shakeouts where
  // the distance isn't a function of week progression).
  fixedKm?: number
  fixedDurationMin?: number
}

// Default weekly template. Mon + Sat omitted = no row = rest day.
// Wed strength because office day blocks AM/lunch run. Fri football because
// Jumu'ah 13–15 blocks lunch run and football is the standing commitment.
export const WEEK_TEMPLATE: DayTemplate[] = [
  { dow: 2, hourLocal: 12, minuteLocal: 30, modality: 'run_threshold' },
  { dow: 3, hourLocal: 19, minuteLocal: 0, modality: 'strength_upper', fixedDurationMin: 40 },
  { dow: 4, hourLocal: 12, minuteLocal: 30, modality: 'run_easy' },
  { dow: 5, hourLocal: 19, minuteLocal: 30, modality: 'football', fixedDurationMin: 50 },
  { dow: 7, hourLocal: 8, minuteLocal: 0, modality: 'run_long' },
]

// Race-week taper template (week 23): Tue 5e, Wed 4e, Thu rest, Fri 3 shake,
// Sat rest, Sun marathon.
export const RACE_WEEK_TEMPLATE: DayTemplate[] = [
  { dow: 2, hourLocal: 12, minuteLocal: 30, modality: 'run_easy', fixedKm: 5 },
  { dow: 3, hourLocal: 12, minuteLocal: 30, modality: 'run_easy', fixedKm: 4 },
  { dow: 5, hourLocal: 12, minuteLocal: 30, modality: 'run_recovery', fixedKm: 3 },
  { dow: 7, hourLocal: 9, minuteLocal: 0, modality: 'run_race', fixedKm: 42.195 },
]

// Static distances for modalities that aren't long-run-driven.
export const EASY_KM_DEFAULT = 9
export const THRESHOLD_KM_DEFAULT = 8
