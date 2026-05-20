import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth/owner'
import { PROGRESSION, MARATHON_DATE, PLAN_FIRST_MONDAY } from '@/lib/plan/progression'
import { addWeeks, todayMondayInAmsterdam } from '@/lib/time/week'
import { extendPlanForOwner } from '@/lib/plan/extend'

interface SessionRow {
  session_at: string
  session_at_local: string
  modality: string
  status: 'planned' | 'completed' | 'skipped' | null
}

async function seedNextWeeks() {
  'use server'
  const result = await extendPlanForOwner()
  const total = result.materialised_weeks.reduce((s, w) => s + w.sessions, 0)
  revalidatePath('/settings/plan')
  revalidatePath('/')
  redirect(
    `/settings/plan?seeded=${total}&weeks=${result.materialised_weeks.length}&skipped=${result.skipped_weeks.length}`,
  )
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const { supabase, user } = await requireOwner()

  const todayMonday = todayMondayInAmsterdam()

  // Pull every existing training_session in the plan window so we can render
  // which weeks have rows vs which are still empty. Use UTC ISO bounds for
  // the query; the comparison against mondayYmd is good enough for bucketing.
  const planStartIso = new Date(PLAN_FIRST_MONDAY + 'T00:00:00Z').toISOString()
  const planEndIso = new Date(addWeeks(PROGRESSION[PROGRESSION.length - 1].mondayYmd, 1) + 'T00:00:00Z').toISOString()

  const { data: existingRaw } = await supabase
    .from('training_sessions')
    .select('session_at, session_at_local, modality, status')
    .eq('user_id', user.id)
    .gte('session_at', planStartIso)
    .lt('session_at', planEndIso)
    .order('session_at', { ascending: true })
    .returns<SessionRow[]>()

  // Group session counts by week-monday for the preview table.
  const countsByWeek = new Map<string, number>()
  const completedByWeek = new Map<string, number>()
  for (const row of existingRaw ?? []) {
    const mon = mondayOfYmdUtc(row.session_at_local.slice(0, 10))
    countsByWeek.set(mon, (countsByWeek.get(mon) ?? 0) + 1)
    if (row.status === 'completed') {
      completedByWeek.set(mon, (completedByWeek.get(mon) ?? 0) + 1)
    }
  }

  const seeded = sp.seeded ? Number(sp.seeded) : null
  const seededWeeks = sp.weeks ? Number(sp.weeks) : null
  const seededSkipped = sp.skipped ? Number(sp.skipped) : null

  return (
    <div className="max-w-[1200px] mx-auto px-7 pt-8 pb-20 space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Marathon plan</h1>
          <p className="text-sm text-muted">
            23 weeks · {PLAN_FIRST_MONDAY} → marathon {MARATHON_DATE}. Targets derived per week from your current data, not a goal time.
          </p>
        </div>
        <a href="/settings" className="text-sm text-muted hover:text-ink">
          ← settings
        </a>
      </header>

      <section className="card bg-panel border border-border rounded-[4px]">
        <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
            Seed the next 4 weeks
          </h2>
          <span className="font-mono text-[11px] text-muted">
            today monday: {todayMonday}
          </span>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-sm text-muted">
            Inserts <span className="text-ink">planned</span> rows for any of the next 4 weeks that don&rsquo;t yet have sessions. Idempotent: weeks that already have rows are skipped. The same code path runs weekly via Vercel cron, so this button is for first-time setup and ad-hoc top-ups.
          </p>
          <form action={seedNextWeeks}>
            <button
              type="submit"
              className="rounded bg-ink text-bg px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Seed next 4 weeks
            </button>
          </form>
          {seeded !== null && (
            <p className="text-sm text-success">
              Seeded {seeded} session{seeded === 1 ? '' : 's'} across {seededWeeks} week{seededWeeks === 1 ? '' : 's'}.
              {seededSkipped && seededSkipped > 0 ? ` Skipped ${seededSkipped} week${seededSkipped === 1 ? '' : 's'} (already had rows).` : ''}
            </p>
          )}
        </div>
      </section>

      <section className="card bg-panel border border-border rounded-[4px]">
        <div className="card-hd flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="m-0 text-[11px] uppercase tracking-[0.1em] text-ink-2 font-semibold">
            23-week progression
          </h2>
          <span className="font-mono text-[11px] text-muted">read-only preview</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="px-4 py-2 font-medium">Wk</th>
              <th className="px-4 py-2 font-medium">Mon</th>
              <th className="px-4 py-2 font-medium text-right">Long km</th>
              <th className="px-4 py-2 font-medium">Note</th>
              <th className="px-4 py-2 font-medium text-right">In DB</th>
              <th className="px-4 py-2 font-medium text-right">Done</th>
            </tr>
          </thead>
          <tbody>
            {PROGRESSION.map(w => {
              const inDb = countsByWeek.get(w.mondayYmd) ?? 0
              const done = completedByWeek.get(w.mondayYmd) ?? 0
              const isCurrent = w.mondayYmd === todayMonday
              const isPast = w.mondayYmd < todayMonday
              return (
                <tr
                  key={w.wk}
                  className={`border-b border-border align-top ${
                    isCurrent ? 'bg-accent-soft text-ink' : isPast ? 'text-faint' : 'text-ink-2'
                  }`}
                >
                  <td className="px-4 py-2 font-mono">{w.wk}</td>
                  <td className="px-4 py-2 font-mono text-xs">{w.mondayYmd}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {w.isRace ? '—' : w.longKm.toFixed(w.longKm % 1 === 0 ? 0 : 1)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {w.isRace ? <span className="text-ink">race week</span> : w.reason}
                    {w.isDown && <span className="text-muted"> · down</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {inDb > 0 ? inDb : <span className="text-faint">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {done > 0 ? done : <span className="text-faint">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function mondayOfYmdUtc(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dow = date.getUTCDay()
  const offset = (dow + 6) % 7
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}
