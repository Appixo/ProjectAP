// Smoke test for the run classifier + lap/stream helpers. No DB, no network —
// pure functions only. Run with: tsx scripts/verify-classifier.ts
//
// Covers the regression this change fixes: a threshold session (jog-dragged
// average pace, but real time above the tempo HR floor or clear interval lap
// structure) must NOT classify as easy.

import {
  classifyRuns,
  modalityToRunType,
  asRunType,
  isQualityType,
  type RunInput,
} from '../lib/run/classify'
import { parseLaps, detectIntervalStructure } from '../lib/run/laps'
import { hrAboveTempoPct } from '../lib/strava/streams'

let failures = 0
function check(name: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures++
}

// --- modality / run_type mapping -------------------------------------------
check('modalityToRunType run_threshold → threshold', modalityToRunType('run_threshold') === 'threshold')
check('modalityToRunType run_vo2 → vo2', modalityToRunType('run_vo2') === 'vo2')
check('modalityToRunType non-run → null', modalityToRunType('strength_upper') === null)
check('asRunType valid', asRunType('threshold') === 'threshold')
check('asRunType invalid → null', asRunType('sprint') === null)
check('asRunType null → null', asRunType(null) === null)
check('isQualityType threshold', isQualityType('threshold') === true)
check('isQualityType vo2', isQualityType('vo2') === true)
check('isQualityType long is NOT quality', isQualityType('long') === false)
check('isQualityType easy is NOT quality', isQualityType('easy') === false)

// --- classifier: a steady easy week ----------------------------------------
const easyWeek: RunInput[] = [
  { id: 1, start_at: '2026-06-01T07:00:00Z', distance_m: 8000, average_speed_mps: 2.8 },
  { id: 2, start_at: '2026-06-02T07:00:00Z', distance_m: 7000, average_speed_mps: 2.78 },
  { id: 3, start_at: '2026-06-04T07:00:00Z', distance_m: 9000, average_speed_mps: 2.82 },
]
const easyTypes = classifyRuns(easyWeek)
check('flat easy runs stay easy', [1, 2, 3].every(id => easyTypes.get(id) === 'easy'))

// --- the regression: threshold session, HR signal --------------------------
// 7 km at a moderate *average* speed (reps + warm-up + jog recoveries) — pace
// alone reads easy, but 30% of moving time was above the tempo HR floor.
const hrSignalWeek: RunInput[] = [
  { id: 10, start_at: '2026-06-01T07:00:00Z', distance_m: 8000, average_speed_mps: 2.8 },
  { id: 11, start_at: '2026-06-02T07:00:00Z', distance_m: 7000, average_speed_mps: 2.85 },
  {
    id: 12,
    start_at: '2026-06-04T07:00:00Z',
    distance_m: 7000,
    average_speed_mps: 2.82,
    hr_above_tempo_frac: 0.3,
  },
]
const hrTypes = classifyRuns(hrSignalWeek)
check('HR-distribution: >15% above tempo floor ⇒ not easy', hrTypes.get(12) !== 'easy')
check('HR-distribution: bumped to tempo', hrTypes.get(12) === 'tempo')
check('low HR-time run stays easy', hrTypes.get(11) === 'easy')

// --- the regression: interval lap structure → threshold --------------------
const intervalWeek: RunInput[] = [
  { id: 20, start_at: '2026-06-01T07:00:00Z', distance_m: 8000, average_speed_mps: 2.8 },
  { id: 21, start_at: '2026-06-02T07:00:00Z', distance_m: 7000, average_speed_mps: 2.85 },
  {
    id: 22,
    start_at: '2026-06-04T07:00:00Z',
    distance_m: 7000,
    average_speed_mps: 2.82,
    interval_structure: true,
  },
]
const intervalTypes = classifyRuns(intervalWeek)
check('interval structure ⇒ threshold', intervalTypes.get(22) === 'threshold')

// a true long run keeps its label even with surges flagged
const longWithSurges: RunInput[] = [
  { id: 30, start_at: '2026-06-01T07:00:00Z', distance_m: 22000, average_speed_mps: 2.7, interval_structure: true },
  { id: 31, start_at: '2026-06-02T07:00:00Z', distance_m: 7000, average_speed_mps: 2.8 },
]
check('long run is not relabelled threshold', classifyRuns(longWithSurges).get(30) === 'long')

// --- lap parsing + interval detection --------------------------------------
const intervalActivity = {
  laps: [
    { lap_index: 1, distance: 1500, moving_time: 540, average_speed: 2.78, average_heartrate: 135 }, // WU
    { lap_index: 2, distance: 1000, moving_time: 250, average_speed: 4.0, average_heartrate: 168 }, // rep
    { lap_index: 3, distance: 400, moving_time: 160, average_speed: 2.5, average_heartrate: 140 }, // jog
    { lap_index: 4, distance: 1000, moving_time: 252, average_speed: 3.97, average_heartrate: 170 }, // rep
    { lap_index: 5, distance: 400, moving_time: 165, average_speed: 2.42, average_heartrate: 138 }, // jog
    { lap_index: 6, distance: 1000, moving_time: 255, average_speed: 3.92, average_heartrate: 171 }, // rep
    { lap_index: 7, distance: 1200, moving_time: 430, average_speed: 2.79, average_heartrate: 142 }, // CD
  ],
}
const intervalLaps = parseLaps(intervalActivity)
check('parseLaps returns laps', !!intervalLaps && intervalLaps.length === 7)
check('detectIntervalStructure: intervals ⇒ true', detectIntervalStructure(intervalLaps) === true)

const steadyActivity = {
  laps: [
    { lap_index: 1, distance: 1000, moving_time: 357, average_speed: 2.80, average_heartrate: 145 },
    { lap_index: 2, distance: 1000, moving_time: 360, average_speed: 2.78, average_heartrate: 146 },
    { lap_index: 3, distance: 1000, moving_time: 355, average_speed: 2.82, average_heartrate: 147 },
    { lap_index: 4, distance: 1000, moving_time: 358, average_speed: 2.79, average_heartrate: 148 },
    { lap_index: 5, distance: 1000, moving_time: 356, average_speed: 2.81, average_heartrate: 148 },
  ],
}
check('detectIntervalStructure: steady ⇒ false', detectIntervalStructure(parseLaps(steadyActivity)) === false)
check('parseLaps single whole-run lap ⇒ null', parseLaps({ laps: [{ distance: 7000, moving_time: 2500, average_speed: 2.8 }] }) === null)

// --- HR-above-tempo from a stream ------------------------------------------
// 6 samples 30 s apart; 3 of the 5 intervals are above the 155 floor → 60%.
const pct = hrAboveTempoPct({
  heartrate: { data: [120, 150, 160, 165, 158, 140] },
  time: { data: [0, 30, 60, 90, 120, 150] },
  moving: { data: [true, true, true, true, true, true] },
})
check('hrAboveTempoPct computes a fraction', pct === 60)
check('hrAboveTempoPct no stream ⇒ null', hrAboveTempoPct(null) === null)

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
