"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
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
  const t = useTranslations("reports.pipelineTab")
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
        if (!cancelled) setError(t("loadFailed"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period, t])

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !bundle ? (
          Array.from({ length: 7 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard title={t("dealsCreated")} value={bundle.cards.dealsCreated.toLocaleString()} icon={Ticket} />
            <MetricCard title={t("dealsWon")} value={bundle.cards.dealsWon.toLocaleString()} icon={CheckCircle2} />
            <MetricCard title={t("dealsLost")} value={bundle.cards.dealsLost.toLocaleString()} icon={XCircle} />
            <MetricCard title={t("conversionRate")} value={fmtPct(bundle.cards.conversionRatePct)} icon={Percent} />
            <MetricCard
              title={t("valueWon")}
              value={formatCurrency(bundle.cards.valueWon, defaultCurrency)}
              icon={DollarSign}
            />
            <MetricCard
              title={t("avgTicket")}
              value={
                bundle.cards.avgTicket == null
                  ? "—"
                  : formatCurrency(bundle.cards.avgTicket, defaultCurrency)
              }
              icon={DollarSign}
            />
            <MetricCard
              title={t("avgCloseTime")}
              value={fmtDays(bundle.cards.avgCloseDays)}
              icon={CalendarClock}
            />
            <MetricCard
              title={t("periodCommission")}
              value={formatCurrency(bundle.cards.commissionWon, defaultCurrency)}
              icon={Coins}
            />
            <MetricCard
              title={t("projectedCommission")}
              value={formatCurrency(bundle.cards.commissionProjected, defaultCurrency)}
              icon={Coins}
              subtitle={t("openDealsSubtitle")}
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
