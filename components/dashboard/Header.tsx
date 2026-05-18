import { daysToRace, planContext, RACE, shortDayDate } from '@/lib/time/race'
import { CopyPromptButton } from '@/components/CopyPromptButton'

export function DashboardHeader() {
  const now = new Date()
  const days = daysToRace(now)
  const plan = planContext(now)
  const today = shortDayDate(now)
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  return (
    <header className="hdr flex items-end justify-between pb-[18px] border-b border-border mb-7 gap-4 flex-wrap">
      <div className="flex items-baseline gap-[18px]">
        <div>
          <div className="text-[12px] text-muted uppercase tracking-[0.08em]">
            days to race
          </div>
          <div className="font-mono text-[56px] font-medium -tracking-[0.02em] leading-none text-ink">
            {days}
          </div>
        </div>
        <div className="text-[13px] text-ink-2">
          <div>
            <b className="font-semibold text-ink">
              {RACE.name} · {RACE.longDateLabel}
            </b>
          </div>
          <div className="text-muted mt-0.5">
            {plan.phase} · plan week {plan.weekNumber} of {plan.totalWeeks}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2 text-right text-[12px] text-muted leading-[1.5]">
        <div>
          <div className="text-ink font-mono text-[13px] -tracking-[0.01em]">
            {today}
          </div>
          <div>Europe/Amsterdam · km · min/km</div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/history"
            className="text-[11px] uppercase tracking-[0.08em] text-muted hover:text-ink"
          >
            history
          </a>
          <a
            href="/log"
            className="text-[11px] uppercase tracking-[0.08em] text-muted hover:text-ink"
          >
            log
          </a>
          <a
            href="/settings"
            className="text-[11px] uppercase tracking-[0.08em] text-muted hover:text-ink"
          >
            settings
          </a>
        </div>
        <CopyPromptButton appUrl={appUrl} />
      </div>
    </header>
  )
}
