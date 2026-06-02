// Strava activity HR-stream ingestion. One extra API call per activity (on
// top of the detail fetch) to pull the per-second heartrate / time / moving
// streams, from which we compute the fraction of moving time spent at or above
// the tempo HR floor. That fraction — not the average HR — is what tells an
// interval/threshold session apart from an easy run: the average is dragged
// down by warm-up + jog recoveries, but the time-in-zone is not.

import { TEMPO_HR_FLOOR_BPM } from '../run/classify'

interface StreamSet {
  heartrate?: { data: number[] }
  time?: { data: number[] }
  moving?: { data: boolean[] }
}

export async function fetchActivityStreams(
  accessToken: string,
  id: number,
): Promise<StreamSet | null> {
  const url = `https://www.strava.com/api/v3/activities/${id}/streams?keys=heartrate,time,moving&key_by_type=true`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  // 404 = no streams (e.g. manual entry). Treat like "no HR data".
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Strava streams ${id} fetch failed: ${res.status}`)
  }
  return (await res.json()) as StreamSet
}

// Percentage (0-100, one decimal) of *moving* time spent at or above the tempo
// HR floor. Returns null when there's no usable HR + time stream. Gaps longer
// than 60 s (auto-pause, signal loss) are skipped so a paused watch doesn't
// inflate or deflate the denominator.
export function hrAboveTempoPct(streams: StreamSet | null): number | null {
  const hr = streams?.heartrate?.data
  const time = streams?.time?.data
  if (!hr?.length || !time?.length) return null
  const moving = streams?.moving?.data
  const n = Math.min(hr.length, time.length)
  if (n < 2) return null

  let movingS = 0
  let aboveS = 0
  for (let i = 1; i < n; i++) {
    const dt = time[i] - time[i - 1]
    if (dt <= 0 || dt > 60) continue
    // moving stream is per-sample; absent → assume moving.
    if (moving && moving[i] === false) continue
    movingS += dt
    if (hr[i] >= TEMPO_HR_FLOOR_BPM) aboveS += dt
  }
  if (movingS <= 0) return null
  return Number(((aboveS / movingS) * 100).toFixed(1))
}
