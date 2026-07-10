"use client"

import { Filter } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { PipelineDonutData, PipelineStageSlice } from '@/lib/dashboard/types'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface ConversionFunnelChartProps {
  /** Reuses the same per-stage open-deal counts the pipeline donut
   *  already loads (loadPipelineDonut) — no separate query. */
  data: PipelineDonutData | null
  loading: boolean
}

export function ConversionFunnelChart({ data, loading }: ConversionFunnelChartProps) {
  const t = useTranslations('dashboard')
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t('conversionFunnel')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('conversionFunnelHint')}</p>
      </header>
      <div className="p-5">
        {loading || !data ? (
          <Skeleton className="h-44 w-full" />
        ) : data.stages.length === 0 ? (
          <EmptyState icon={Filter} title={t('noOpenDeals')} hint={t('noOpenDealsHint')} />
        ) : (
          <FunnelBars stages={data.stages} />
        )}
      </div>
    </section>
  )
}

// Bar width is each stage's share of the BUSIEST stage, not the first —
// a literal "% of stage 1" funnel looks right in a mockup with invented,
// monotonically-decreasing numbers, but real pipelines routinely have
// more deals sitting in an "in review" middle stage than in "new lead"
// (leads move through the first stage fast; they linger in the middle
// ones). Normalizing against the first stage alone made every other bar
// clip to 100% width against real data, which erased the funnel shape
// entirely — normalizing against the max keeps every stage's relative
// size legible regardless of which one happens to be busiest.
function FunnelBars({ stages }: { stages: PipelineStageSlice[] }) {
  const baseline = Math.max(1, ...stages.map((s) => s.dealCount))
  const lastIndex = stages.length - 1

  return (
    <ul className="space-y-2.5">
      {stages.map((s, i) => {
        // Floor keeps a stage with a handful of deals visible against a
        // baseline of hundreds — a real risk once an account has been
        // live a while, not just a hypothetical edge case.
        const pct = Math.max((s.dealCount / baseline) * 100, 6)
        const isLast = i === lastIndex
        return (
          <li key={s.id} className="flex items-center gap-3">
            <span className="w-24 shrink-0 truncate text-xs text-muted-foreground sm:w-32">
              {s.name}
            </span>
            <div className="relative h-7 min-w-0 flex-1 rounded-md bg-muted/40">
              <div
                className={cn(
                  'flex h-7 items-center justify-end rounded-md px-2 transition-[width]',
                  isLast ? 'bg-gold' : 'bg-primary',
                )}
                style={{ width: `${pct}%` }}
              >
                <span
                  className={cn(
                    'font-mono text-xs font-semibold tabular-nums',
                    isLast ? 'text-gold-foreground' : 'text-primary-foreground',
                  )}
                >
                  {s.dealCount}
                </span>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
