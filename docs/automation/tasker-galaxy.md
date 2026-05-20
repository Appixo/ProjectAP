# Galaxy Watch → Health Connect → Tasker → daily_log

Every morning, push last night's sleep, HRV, and morning resting HR from the
Galaxy Watch into the dashboard without opening it.

## Why this path

Samsung Health has no public REST API. The boring, proven route on Android
is:

1. **Galaxy Watch** records sleep, HRV (RMSSD), and resting HR overnight.
2. **Samsung Health** on the phone receives it.
3. **Health Connect** (built into Android 14+) exposes those fields to
   other apps with explicit permission.
4. **Tasker** reads Health Connect, builds an HTTP request, fires it at
   `/api/daily-logs`.
5. The dashboard upserts the row keyed on `(user_id, date)`.

No partner agreements, no cloud round-trips, no scraping. The watch already
syncs to Samsung Health; Samsung Health already writes to Health Connect.
We add one Tasker task that runs once a day.

## Prerequisites

- **Android 14+** with **Health Connect** available (system app or from
  Play Store).
- **Tasker** ([Play Store](https://play.google.com/store/apps/details?id=net.dinglisch.android.tasker))
  — paid one-time.
- **Health Connect plugin for Tasker** (a separate small app — search Play
  Store for "Health Connect Tasker"; pick the one with explicit Tasker
  integration).
- A **write-scoped API token** from the dashboard's Settings → API tokens.
  Tick "Allow writing sessions" when creating it; copy the raw token (you
  only see it once).

## One-time permissions

1. Open **Samsung Health** → Settings → Health Connect → enable export for
   sleep, heart rate variability, and resting heart rate.
2. Open **Health Connect** → Apps & permissions → grant the Tasker plugin
   read access for sleep sessions, HRV, and resting HR.
3. In **Tasker**, grant the Health Connect plugin permission as prompted on
   first task run.

## Tasker profile

**Name:** `Morning sync — daily_log`

**Trigger** (pick one):

- **Time → 09:00** every day. Simplest. Health Connect's previous-night
  sleep is finalised by then.
- **Event → Health Connect data updated**. Lower latency, fires shortly
  after sleep is logged. Requires the plugin to expose the event.

## Tasker task

Six actions. Each Health Connect read uses the plugin (action category
varies by plugin name — look for "Health Connect" or "HC").

### Action 1 — Read sleep session

- **Action**: Health Connect → Get Sleep Session (last 24h).
- **Variable**: `%SH` ← duration in hours (1 decimal).
- **Variable**: `%BT` ← session start, formatted `%H:%M`.
- **Variable**: `%WT` ← session end, formatted `%H:%M`.

If the plugin returns durations in minutes, divide by 60 in a
**Variable Math** action: `%SH = %SH / 60`, set Precision = 1.

### Action 2 — Read HRV (RMSSD)

- **Action**: Health Connect → Get HRV RMSSD (last 24h, mean).
- **Variable**: `%HRV` ← integer milliseconds.

### Action 3 — Read resting heart rate

- **Action**: Health Connect → Get Resting Heart Rate (today, latest).
- **Variable**: `%RHR` ← integer bpm.

### Action 4 — Today's date in YYYY-MM-DD

- **Action**: Variables → Variable Set.
- **Name**: `%DATE`
- **To**: `%DATE`  (Tasker built-in, returns `YYYY-MM-DD` in local time).

### Action 5 — HTTP Request

- **Action**: Net → HTTP Request.
- **Method**: `POST`
- **URL**: `https://project-ap.vercel.app/api/daily-logs?token=YOUR_WRITE_TOKEN`
- **Headers**: `Content-Type: application/json`
- **Body** (paste exactly — Tasker substitutes the `%`-variables):

```json
{
  "date": "%DATE",
  "sleep_hours": %SH,
  "bedtime": "%BT",
  "wake_time": "%WT",
  "morning_rhr_bpm": %RHR,
  "hrv_ms": %HRV
}
```

- **Output variables**: `%HTTPR` (response code), `%HTTPD` (response body).

### Action 6 — Notify on failure

- **Action**: Alert → Notify.
- **If**: `%HTTPR neq 200`.
- **Title**: `daily-log sync failed`
- **Text**: `HTTP %HTTPR — %HTTPD`

## Verify it works

1. Save the task in Tasker.
2. **Run task manually** (long-press → Run).
3. In the dashboard, open `/log`. Today's row should have `sleep_hours`,
   `bedtime`, `wake_time`, `morning_rhr_bpm`, and `hrv_ms` populated.
4. If the row exists but a field is missing, that field wasn't returned by
   Health Connect (likely permission denied or no data yet). Re-check the
   permissions chain above.

## Troubleshooting

- **HTTP 401**: token wrong, expired, or revoked. Recreate in Settings.
- **HTTP 403** (`token_read_only`): the token doesn't have write scope.
  Tick "Allow writing sessions" when creating a new one.
- **HTTP 400 `invalid_sleep_hours`**: Tasker substituted an empty string —
  the Health Connect read returned no data. Wrap the field in an `If %SH`
  guard so the task aborts when sleep wasn't logged.
- **HTTP 400 `invalid_bedtime`**: format is `HH:MM` (24h). If the plugin
  returns `21:30:00`, that's also valid; the endpoint accepts both. But
  `9:30 PM` or `21h30` will fail.
- **Task never fires**: Android battery optimisation killed Tasker. Settings
  → Apps → Tasker → Battery → Unrestricted.

## Fields the watch fills vs what stays manual

| Field | Source |
|---|---|
| `sleep_hours`, `bedtime`, `wake_time` | Health Connect sleep_session |
| `morning_rhr_bpm` | Health Connect resting_heart_rate |
| `hrv_ms` | Health Connect heart_rate_variability_rmssd |
| `sleep_quality_1_5`, `mood_1_5`, `stress_1_5` | Manual via /log |
| `body_weight_kg`, `notes`, `soreness` | Manual via /log |

The upsert is partial — sending only the auto fields leaves manual fields
untouched, so the Tasker task can run before you've opened the form.

## A fallback for when Tasker is overkill

If the Tasker setup is more friction than the typing it replaces, drop it
and use this Android homescreen shortcut instead:

- Long-press homescreen → Shortcuts → Custom URL.
- URL: `https://project-ap.vercel.app/log?date=today`
- One tap → form opens with today's date pre-filled. Type the four numbers
  the watch displayed; save. ~10 seconds.

Less impressive, equally consistent. Pick the path you'll actually stick
with.
