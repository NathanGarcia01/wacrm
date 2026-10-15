"use client"

import { useTranslations } from "next-intl"
import { ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface PipelineFunnelStep {
  id: string
  name: string
  color: string
  count: number
}

/** Cumulative stage-reach funnel, stacked as horizontal bars (widest
 *  at top, narrowing going down) — same layout on every screen size,
 *  no side-scroll needed on mobile. `steps` is expected pre-built by
 *  the caller as a CUMULATIVE count per stage ("how many of this
 *  cohort reached this stage or further"), so counts are
 *  monotonically non-increasing top to bottom by construction; this
 *  component only lays them out and computes the pass-through %
 *  between consecutive rows. */
export function PipelineFunnelChart({
  steps,
  subtitle,
}: {
  steps: PipelineFunnelStep[]
  /** Pre-built explanation of what cohort the funnel represents, e.g.
   *  "Dos 179 negócios criados em outubro, 6 já viraram contrato" —
   *  built by the caller since it needs the period's month label. */
  subtitle?: string | null
}) {
  const t = useTranslations("reports.pipelineFunnelChart")

  const nonZero = steps.filter((s) => s.count > 0)

  if (steps.length === 0 || nonZero.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground">{t("title")}</p>
        <p className="mt-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
      </div>
    )
  }

  const max = Math.max(...steps.map((s) => s.count), 1)

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm font-semibold text-foreground">{t("title")}</p>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-5 space-y-1.5">
        {steps.map((step, i) => {
          const prev = i > 0 ? steps[i - 1] : null
          const passThroughPct = prev && prev.count > 0 ? Math.round((step.count / prev.count) * 100) : null
          const widthPct = Math.max((step.count / max) * 100, step.count > 0 ? 3 : 1.5)
          const isLast = i === steps.length - 1
          return (
            <div key={step.id}>
              {i > 0 && passThroughPct != null && (
                <div className="flex items-center gap-1 py-1 pl-1 text-[11px] text-muted-foreground">
                  <ArrowDown className="h-3 w-3" aria-hidden />
                  <span className="tabular-nums">{passThroughPct}%</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{step.name}</span>
                <span className="shrink-0 font-semibold tabular-nums text-foreground">
                  {step.count.toLocaleString()}
                </span>
              </div>
              <div className="mt-1 h-7 w-full overflow-hidden rounded-md bg-muted">
                <div
                  className={cn("h-full rounded-md transition-all", isLast && "bg-primary")}
                  style={{ width: `${widthPct}%`, backgroundColor: isLast ? undefined : step.color }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
