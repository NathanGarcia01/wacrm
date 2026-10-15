"use client"

import type { ComponentType } from "react"
import { cn } from "@/lib/utils"

/** One entry in a tab's "Outros indicadores" secondary strip — a
 *  smaller, label+value pair (no full MetricCard chrome) for numbers
 *  that matter but don't need to compete with the headline cards. */
export function CompactStat({
  icon: Icon,
  label,
  value,
  hint,
  className,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
  hint?: string
  /** Extra classes on the value text — e.g. a positive tint for a
   *  stat that's good news even without a delta (commission earned). */
  className?: string
}) {
  return (
    <div className="flex items-start gap-2" title={hint}>
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className={cn("text-sm font-semibold tabular-nums text-foreground", className)}>{value}</p>
      </div>
    </div>
  )
}
