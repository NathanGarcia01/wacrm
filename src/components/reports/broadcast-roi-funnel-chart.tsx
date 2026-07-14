"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/dashboard/skeleton"

interface FunnelStage {
  key: string
  label: string
  value: number
}

interface BroadcastRoiFunnelChartProps {
  /** Null while loading; pass an already-labeled stage list so this
   *  chart can be shared across reports with different translation
   *  namespaces (broadcasts tab, broadcast ROI tab) without hardcoding
   *  one. */
  stages: FunnelStage[] | null
  loading: boolean
  title: string
}

/**
 * Generic decreasing-funnel bar chart — e.g. Sent → Replied → Deals
 * Created → Deals Won. Same visual language as the Dashboard's
 * pipeline funnel (conversion-funnel-chart.tsx): decreasing bars
 * normalized against the busiest stage, primary fill throughout, gold
 * reserved for the final/most-valuable stage.
 */
export function BroadcastRoiFunnelChart({ stages: stagesProp, loading, title }: BroadcastRoiFunnelChartProps) {
  const stages = stagesProp ?? []
  const baseline = Math.max(1, ...stages.map((s) => s.value))
  const lastIndex = stages.length - 1

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </header>
      <div className="p-5">
        {loading || !stagesProp ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ul className="space-y-2.5">
            {stages.map((s, i) => {
              const pct = Math.max((s.value / baseline) * 100, 6)
              const isLast = i === lastIndex
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs text-muted-foreground sm:w-36">
                    {s.label}
                  </span>
                  <div className="relative h-7 min-w-0 flex-1 rounded-md bg-muted/40">
                    <div
                      className={cn(
                        "flex h-7 items-center justify-end rounded-md px-2 transition-[width]",
                        isLast ? "bg-gold" : "bg-primary",
                      )}
                      style={{ width: `${pct}%` }}
                    >
                      <span
                        className={cn(
                          "font-mono text-xs font-semibold tabular-nums",
                          isLast ? "text-gold-foreground" : "text-primary-foreground",
                        )}
                      >
                        {s.value.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
