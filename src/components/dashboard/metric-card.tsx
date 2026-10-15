import { ArrowDown, ArrowUp, HelpCircle, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Sparkline } from '@/components/dashboard/sparkline'

interface MetricCardProps {
  title: string
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string
  icon: ComponentType<{ className?: string }>
  /**
   * Delta-mode secondary row: arrow + delta text. Omit when the metric
   * doesn't have a sensible comparison (e.g. total pipeline value).
   */
  delta?: {
    /** Positive / negative / zero drives the color (green/red/muted). */
    sign: number
    /** Pre-formatted delta, e.g. "+3 vs yesterday". */
    label: string
    /** Same change with no trailing "vs X" phrase, shown instead of
     *  `label` below the `sm` breakpoint so the row fits one line in
     *  a narrow mobile KPI card. Falls back to `label` when absent. */
    shortLabel?: string
    /**
     * Positive / negative / zero drives the arrow, when it needs to
     * differ from `sign` — e.g. a response time that got FASTER is
     * good news (`sign` > 0, green) but the raw number went DOWN (the
     * arrow should still point down). Defaults to `sign`.
     */
    arrowSign?: number
  }
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string
  /** Explanation of how the metric is calculated, shown behind a help
   *  icon next to the title — nobody should have to trust a number
   *  without knowing what it measures. */
  tooltip?: string
  /** Optional per-day values behind the delta row — purely decorative
   *  trend shape, rendered only when there are enough points to draw
   *  a line. */
  sparkline?: number[]
  /** Subtly tints the card (e.g. the single most important KPI on a
   *  tab) without implying a delta/alert — distinct from the
   *  green/red the delta row already uses for direction. */
  highlight?: boolean
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  delta,
  subtitle,
  tooltip,
  sparkline,
  highlight,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-5',
        highlight && 'border-primary/30 bg-primary/5',
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger className="text-muted-foreground/70 hover:text-muted-foreground">
                <HelpCircle className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-[28px] leading-none font-bold tabular-nums text-foreground">
        {value}
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        {delta ? (
          <DeltaRow
            sign={delta.sign}
            arrowSign={delta.arrowSign ?? delta.sign}
            label={delta.label}
            shortLabel={delta.shortLabel}
          />
        ) : subtitle ? (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        ) : (
          <span />
        )}
        {sparkline && sparkline.length >= 2 && (
          <Sparkline
            values={sparkline}
            tone={delta ? (delta.sign > 0 ? 'good' : delta.sign < 0 ? 'bad' : 'default') : 'default'}
            className="h-5 w-16 shrink-0"
          />
        )}
      </div>
    </div>
  )
}

function DeltaRow({
  sign,
  arrowSign,
  label,
  shortLabel,
}: {
  sign: number
  arrowSign: number
  label: string
  shortLabel?: string
}) {
  const tone =
    sign > 0
      ? 'text-primary'
      : sign < 0
      ? 'text-destructive'
      : 'text-muted-foreground'
  const Arrow = arrowSign > 0 ? ArrowUp : arrowSign < 0 ? ArrowDown : Minus
  return (
    <div className={cn('flex min-w-0 items-center gap-1 text-sm', tone)}>
      <Arrow className="h-4 w-4 shrink-0" aria-hidden />
      {shortLabel ? (
        <>
          <span className="truncate tabular-nums sm:hidden">{shortLabel}</span>
          <span className="hidden truncate tabular-nums sm:inline">{label}</span>
        </>
      ) : (
        <span className="truncate tabular-nums">{label}</span>
      )}
    </div>
  )
}
