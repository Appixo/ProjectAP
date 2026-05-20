// Plan generator. Pure function: takes a slice of PROGRESSION + the user's
// current derived metrics, returns rows ready to POST to /api/sessions.
//
// Targets are derived from observed data, never a goal time:
//   - HR caps from derived.easy_hard_split_28d_pct.personal_max_bpm
//   - Pace bands from derived.riegel_basis (fastest recent 5K+)
// If derived inputs are missing, the generator falls back to Tanaka's
// age-predicted max (192 bpm at age 28) and omits pace targets.

import type { DerivedMetrics } from '@/lib/run/derived'
import { addDays } from '@/lib/time/week'
import {
  type WeekSpec,
  type DayTemplate,
  type PlanModality,
  WEEK_TEMPLATE,
  RACE_WEEK_TEMPLATE,
  EASY_KM_DEFAULT,
  THRESHOLD_KM_DEFAULT,
} from './progression'

const TANAKA_MAX_HR_AGE_28 = 192
const PACE_LOWER_BOUND_SPK = 120
const PACE_UPPER_BOUND_SPK = 900

export interface PlanDescription {
  target_distance_km?: number
  target_duration_min?: number
  target_hr_min?: number
  target_hr_max?: number
  target_pace_s_per_km_min?: number
  target_pace_s_per_km_max?: number
  reason?: string
}

export interface SessionInput {
  session_at_local: string
  modality: PlanModality
  duration_min?: number
  status: 'planned'
  description?: PlanDescription
}

export interface GenerateOpts {
  weeks: WeekSpec[]
  derived: DerivedMetrics
}

interface ResolvedBasis {
  personalMaxBpm: number
  /** Provisional = personal_max came from Tanaka, not from observed HR. */
  hrProvisional: boolean
  /** Fastest recent 5K+ pace in s/km, or null if unavailable. */
  basisPaceSpk: number | null
}

function resolveBasis(derived: DerivedMetrics): ResolvedBasis {
  const observedMax = derived.easy_hard_split_28d_pct?.personal_max_bpm
  const personalMaxBpm = observedMax ?? TANAKA_MAX_HR_AGE_28
  const hrProvisional = observedMax == null

  let basisPaceSpk: number | null = null
  if (derived.riegel_basis && derived.riegel_basis.distance_m > 0) {
    basisPaceSpk = Math.round(
      (derived.riegel_basis.moving_time_s / derived.riegel_basis.distance_m) * 1000,
    )
  }

  return { personalMaxBpm, hrProvisional, basisPaceSpk }
}

function clampPace(spk: number): number {
  return Math.max(PACE_LOWER_BOUND_SPK, Math.min(PACE_UPPER_BOUND_SPK, Math.round(spk)))
}

function hrBand(personalMax: number, minFrac: number, maxFrac: number) {
  return {
    target_hr_min: Math.round(personalMax * minFrac),
    target_hr_max: Math.round(personalMax * maxFrac),
  }
}

function paceBand(
  basis: number | null,
  multiplier: number,
  spreadPct: number,
): { target_pace_s_per_km_min?: number; target_pace_s_per_km_max?: number } {
  if (basis == null) return {}
  const mid = basis * multiplier
  return {
    target_pace_s_per_km_min: clampPace(mid * (1 - spreadPct)),
    target_pace_s_per_km_max: clampPace(mid * (1 + spreadPct)),
  }
}

function buildDescription(
  modality: PlanModality,
  week: WeekSpec,
  template: DayTemplate,
  basis: ResolvedBasis,
): PlanDescription | undefined {
  const reasonParts: string[] = []
  if (basis.hrProvisional && (modality === 'run_threshold' || modality === 'run_easy')) {
    reasonParts.push('HR targets provisional — needs lthr_test or max_hr_test')
  }

  switch (modality) {
    case 'run_easy': {
      const km = template.fixedKm ?? EASY_KM_DEFAULT
      reasonParts.push('easy — HR-led conversational')
      return {
        target_distance_km: km,
        ...hrBand(basis.personalMaxBpm, 0.72, 0.80),
        ...paceBand(basis.basisPaceSpk, 1.3, 0.05),
        reason: reasonParts.join('; '),
      }
    }
    case 'run_threshold': {
      reasonParts.push('threshold per 2026-05 read; avg HR mid-150s')
      return {
        target_distance_km: THRESHOLD_KM_DEFAULT,
        ...hrBand(basis.personalMaxBpm, 0.85, 0.88),
        ...paceBand(basis.basisPaceSpk, 1.05, 0.03),
        reason: reasonParts.join('; '),
      }
    }
    case 'run_long': {
      const reasonBits = [week.reason]
      if (week.mondayYmd >= '2026-06-01' && week.mondayYmd <= '2026-08-31') {
        reasonBits.push('start by 07:00, refuel before')
      }
      return {
        target_distance_km: week.longKm,
        ...hrBand(basis.personalMaxBpm, 0.75, 0.82),
        ...paceBand(basis.basisPaceSpk, 1.2, 0.08),
        reason: reasonBits.filter(Boolean).join('; '),
      }
    }
    case 'run_recovery': {
      const km = template.fixedKm ?? 5
      return {
        target_distance_km: km,
        target_hr_max: Math.round(basis.personalMaxBpm * 0.70),
        ...paceBand(basis.basisPaceSpk, 1.4, 0.10),
        reason: 'shakeout — HR-led, not pace-led',
      }
    }
    case 'run_race': {
      return {
        target_distance_km: template.fixedKm ?? 42.195,
        reason: 'goal day — execute the plan, race-day pacing decided morning of',
      }
    }
    case 'football': {
      return {
        target_duration_min: template.fixedDurationMin ?? 50,
        reason: 'Fri football 6v6 2x25min — standing commitment',
      }
    }
    case 'strength_upper':
    case 'strength_lower': {
      return {
        target_duration_min: template.fixedDurationMin ?? 40,
        reason: 'injury-resilience volume — short, controlled',
      }
    }
    default:
      return undefined
  }
}

function buildSession(
  week: WeekSpec,
  template: DayTemplate,
  basis: ResolvedBasis,
): SessionInput {
  const dateYmd = addDays(week.mondayYmd, template.dow - 1)
  const hh = String(template.hourLocal).padStart(2, '0')
  const mm = String(template.minuteLocal).padStart(2, '0')
  const sessionAtLocal = `${dateYmd}T${hh}:${mm}`

  const description = buildDescription(template.modality, week, template, basis)
  const session: SessionInput = {
    session_at_local: sessionAtLocal,
    modality: template.modality,
    status: 'planned',
  }
  if (description) session.description = description
  if (template.fixedDurationMin) session.duration_min = template.fixedDurationMin
  return session
}

export function generatePlan({ weeks, derived }: GenerateOpts): SessionInput[] {
  const basis = resolveBasis(derived)
  const out: SessionInput[] = []
  for (const w of weeks) {
    const tpl = w.isRace ? RACE_WEEK_TEMPLATE : WEEK_TEMPLATE
    for (const d of tpl) {
      out.push(buildSession(w, d, basis))
    }
  }
  return out
}
