// Year-of-training heatmap, GitHub-contribution-graph style. Cell intensity =
// total training minutes that day across all modalities (run moving time +
// session duration_min). Hover tooltip via the native title attribute, which
// avoids extra JS for what's a glance-only surface.

export interface HeatmapDay {
  ymd: string // YYYY-MM-DD Amsterdam
  totalMin: number
  /** One-line "29.4 km run + 50 min football" for the hover tooltip. */
  breakdown: string
}

const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''] // sparse for compactness
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function intensityLevel(min: number): 0 | 1 | 2 | 3 | 4 {
  if (min <= 0) return 0
  if (min < 30) return 1
  if (min < 60) return 2
  if (min < 90) return 3
  return 4
}

// color-mix lets us hold a single accent token (oklch) and ramp the alpha
// without spawning five custom utility classes. Falls back gracefully — the
// 0 case uses a fully-transparent fill with a thin border for the empty
// look.
function cellStyle(level: 0 | 1 | 2 | 3 | 4): React.CSSProperties {
  if (level === 0) {
    return {
      backgroundColor: 'transparent',
      border: '1px solid var(--color-border)',
    }
  }
  const pct = { 1: 22, 2: 40, 3: 65, 4: 92 }[level]
  return {
    backgroundColor: `color-mix(in oklch, var(--color-accent) ${pct}%, transparent)`,
  }
}

interface ColumnSpec {
  mondayYmd: string
  days: (HeatmapDay | null)[] // length 7, Mon..Sun; null = before-start or after-end
  showMonthLabel: string | null
}

function buildColumns(days: HeatmapDay[]): ColumnSpec[] {
  if (days.length === 0) return []
  // Find the Monday on or before the first day.
  const firstYmd = days[0].ymd
  const [fy, fm, fd] = firstYmd.split('-').map(Number)
  const firstDate = new Date(Date.UTC(fy, fm - 1, fd))
  const dow = firstDate.getUTCDay() // 0=Sun..6=Sat
  const offsetToMonday = (dow + 6) % 7
  const gridStart = new Date(firstDate)
  gridStart.setUTCDate(firstDate.getUTCDate() - offsetToMonday)

  const lastYmd = days[days.length - 1].ymd
  const [ly, lm, ld] = lastYmd.split('-').map(Number)
  const lastDate = new Date(Date.UTC(ly, lm - 1, ld))

  const byYmd = new Map(days.map(d => [d.ymd, d]))
  const cols: ColumnSpec[] = []
  let prevMonthLabel: string | null = null

  for (let cursor = new Date(gridStart); cursor <= lastDate; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    const mondayYmd = cursor.toISOString().slice(0, 10)
    const colDays: (HeatmapDay | null)[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor)
      d.setUTCDate(cursor.getUTCDate() + i)
      const ymd = d.toISOString().slice(0, 10)
      colDays.push(byYmd.get(ymd) ?? null)
    }
    // Month label fires when the column contains the first cell of a new month.
    let monthLabel: string | null = null
    const monthOfFirstReal = colDays.find(d => d !== null)
    if (monthOfFirstReal) {
      const monthIdx = Number(monthOfFirstReal.ymd.slice(5, 7)) - 1
      const dayOfMonth = Number(monthOfFirstReal.ymd.slice(8, 10))
      // Label this column if it contains a date in the first week of the month
      // (1–7) AND the label differs from the previous column's label.
      if (dayOfMonth <= 7 && MONTH_ABBR[monthIdx] !== prevMonthLabel) {
        monthLabel = MONTH_ABBR[monthIdx]
        prevMonthLabel = monthLabel
      }
    }
    cols.push({ mondayYmd, days: colDays, showMonthLabel: monthLabel })
  }

  return cols
}

export interface YearHeatmapProps {
  days: HeatmapDay[]
  title?: string
}

export function YearHeatmap({ days, title = 'Training year' }: YearHeatmapProps) {
  const columns = buildColumns(days)
  const totalMin = days.reduce((s, d) => s + d.totalMin, 0)
  const activeDays = days.filter(d => d.totalMin > 0).length
  const totalHours = totalMin / 60

  return (
    <section className="card bg-panel border border-border rounded-[4px]">
      <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
          {title}
        </h2>
        <span className="font-mono text-[11px] text-muted -tracking-[0.01em]">
          {activeDays} active days · {totalHours.toFixed(0)} h total
        </span>
      </div>

      <div className="px-4 py-4 overflow-x-auto">
        <div className="inline-block">
          {/* month-label row */}
          <div className="flex gap-[2px] pl-[28px] mb-1">
            {columns.map(col => (
              <div
                key={`m-${col.mondayYmd}`}
                className="w-[11px] text-[9px] font-mono text-muted leading-none"
              >
                {col.showMonthLabel ?? ''}
              </div>
            ))}
          </div>

          <div className="flex gap-[2px]">
            {/* weekday-label column */}
            <div className="flex flex-col gap-[2px] pr-1 w-[24px]">
              {WEEKDAY_LABELS.map((lbl, i) => (
                <div
                  key={i}
                  className="h-[11px] text-[9px] font-mono text-muted leading-[11px] text-right"
                >
                  {lbl}
                </div>
              ))}
            </div>

            {/* week columns */}
            {columns.map(col => (
              <div key={col.mondayYmd} className="flex flex-col gap-[2px]">
                {col.days.map((d, i) => {
                  if (d === null) {
                    return (
                      <div
                        key={i}
                        className="w-[11px] h-[11px] rounded-[2px]"
                        style={{ backgroundColor: 'transparent' }}
                      />
                    )
                  }
                  const lvl = intensityLevel(d.totalMin)
                  return (
                    <div
                      key={i}
                      className="w-[11px] h-[11px] rounded-[2px]"
                      style={cellStyle(lvl)}
                      title={`${d.ymd} · ${d.totalMin > 0 ? `${d.totalMin} min — ${d.breakdown}` : 'rest'}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>

          {/* legend */}
          <div className="flex items-center gap-2 mt-2 pl-[28px] text-[10px] font-mono text-muted">
            <span>less</span>
            {[0, 1, 2, 3, 4].map(l => (
              <div
                key={l}
                className="w-[11px] h-[11px] rounded-[2px]"
                style={cellStyle(l as 0 | 1 | 2 | 3 | 4)}
              />
            ))}
            <span>more</span>
            <span className="text-faint ml-3">cell = total minutes; &lt;30 / 30–59 / 60–89 / 90+</span>
          </div>
        </div>
      </div>
    </section>
  )
}
