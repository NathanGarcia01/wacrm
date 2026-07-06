"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import { CalendarClock, CheckCircle2, Coins, DollarSign, Percent, Ticket, XCircle } from "lucide-react"
import { loadPipelineReport } from "@/lib/reports/pipeline-queries"
import type { PeriodRange, PipelineReportBundle } from "@/lib/reports/types"
import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { PipelineFunnelChart } from "@/components/reports/pipeline-funnel-chart"
import { DealsPerDayChart } from "@/components/reports/deals-per-day-chart"
import { DealsTable } from "@/components/reports/deals-table"
import { CommissionAgentRankingTable } from "@/components/reports/commission-agent-ranking-table"

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}%`
}

function fmtDays(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}d`
}

export function PipelineTab({ period }: { period: PeriodRange }) {
  const { defaultCurrency } = useAuth()
  const [bundle, setBundle] = useState<PipelineReportBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const db = createClient()
    loadPipelineReport(db, period)
      .then((b) => {
        if (!cancelled) setBundle(b)
      })
      .catch((err) => {
        console.error("[reports] pipeline load failed:", err)
        if (!cancelled) setError("Não foi possível carregar os dados de pipeline.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period])

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !bundle ? (
          Array.from({ length: 7 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard title="Deals criados" value={bundle.cards.dealsCreated.toLocaleString()} icon={Ticket} />
            <MetricCard title="Deals ganhos" value={bundle.cards.dealsWon.toLocaleString()} icon={CheckCircle2} />
            <MetricCard title="Deals perdidos" value={bundle.cards.dealsLost.toLocaleString()} icon={XCircle} />
            <MetricCard title="Taxa de conversão" value={fmtPct(bundle.cards.conversionRatePct)} icon={Percent} />
            <MetricCard
              title="Valor ganho"
              value={formatCurrency(bundle.cards.valueWon, defaultCurrency)}
              icon={DollarSign}
            />
            <MetricCard
              title="Ticket médio"
              value={
                bundle.cards.avgTicket == null
                  ? "—"
                  : formatCurrency(bundle.cards.avgTicket, defaultCurrency)
              }
              icon={DollarSign}
            />
            <MetricCard
              title="Tempo médio de fechamento"
              value={fmtDays(bundle.cards.avgCloseDays)}
              icon={CalendarClock}
            />
            <MetricCard
              title="Comissão do período"
              value={formatCurrency(bundle.cards.commissionWon, defaultCurrency)}
              icon={Coins}
            />
            <MetricCard
              title="Comissão prevista"
              value={formatCurrency(bundle.cards.commissionProjected, defaultCurrency)}
              icon={Coins}
              subtitle="Deals em aberto"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PipelineFunnelChart stages={bundle?.funnel ?? []} />
        <DealsPerDayChart data={bundle?.dealsPerDay ?? []} />
      </div>

      <CommissionAgentRankingTable
        rows={bundle?.commissionByAgent ?? []}
        loading={loading}
        currency={defaultCurrency}
      />

      <DealsTable deals={bundle?.deals ?? []} loading={loading} />
    </div>
  )
}
