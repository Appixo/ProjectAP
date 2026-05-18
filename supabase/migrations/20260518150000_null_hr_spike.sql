-- Null out a single sensor-spike HR value on a known activity. The wrist
-- watch reported max_heartrate=211 on 2026-01-21 while the average HR for
-- the same run was 150.6 — physiologically impossible jump, confirmed by
-- the user as a watch artefact (they have since switched to an arm-band
-- sensor). The derived metrics already filter values >215 at the deriver
-- level and at Strava ingest, but this row's raw value still reads 211
-- and would mislead any direct inspection of the activities table.

update public.activities
set max_heartrate = null,
    updated_at = now()
where id = 17129314677
  and max_heartrate = 211;
