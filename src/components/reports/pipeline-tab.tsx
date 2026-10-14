"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import {
  CalendarClock,
  CheckCircle2,
  Coins,
  DollarSign,
  Hourglass,
  Percent,
  Ticket,
  XCircle,
} from "lucide-react"
import { loadPipelineCards, loadPipelineReport } from "@/lib/reports/pipeline-queries"
import { previousPeriod } from "@/lib/reports/period"
import { pointsDelta, relativeDelta, type DeltaLabels } from "@/lib/reports/delta"
import type { PeriodRange, PipelineReportBundle, PipelineReportCards } from "@/lib/reports/types"
import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { CompactStat } from "@/components/reports/compact-stat"
import { PipelineFunnelChart } from "@/components/reports/pipeline-funnel-chart"
import { DealsPerDayChart } from "@/components/reports/deals-per-day-chart"
import { DealsTable } from "@/components/reports/deals-table"
import { CommissionAgentRankingTable } from "@/components/reports/commission-agent-ranking-table"
import { PipelineLossReasonChart } from "@/components/reports/pipeline-loss-reason-chart"
import { TicketConversionBySourceTable } from "@/components/reports/ticket-conversion-by-source-table"
import { TicketConversionByCampaignTable } from "@/components/reports/ticket-conversion-by-campaign-table"
import { SalesGoalCard } from "@/components/reports/sales-goal-card"

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}%`
}

function fmtDays(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}d`
}

export function PipelineTab({ period }: { period: PeriodRange }) {
  const t = useTranslations("reports.pipelineTab")
  const deltaLabels: DeltaLabels = {
    vsPrevious: t("vsPreviousPeriod"),
    new: t("newVsPreviousPeriod"),
    flat: t("flatVsPreviousPeriod"),
  }
  const { account, defaultCurrency } = useAuth()
  const accountId = account?.id ?? null
  const timezone = account?.timezone ?? "America/Sao_Paulo"
  const [bundle, setBundle] = useState<PipelineReportBundle | null>(null)
  const [previousCards, setPreviousCards] = useState<PipelineReportCards | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    const db = createClient()
    Promise.all([
      loadPipelineReport(db, period, accountId, timezone),
      loadPipelineCards(db, previousPeriod(period), accountId),
    ])
      .then(([b, prevCards]) => {
        if (cancelled) return
        setBundle(b)
        setPreviousCards(prevCards)
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
  }, [period, accountId, timezone, t])

  const cards = bundle?.cards ?? null

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Headline — the 5 numbers that answer "how did sales go", each
          with a trend vs. the immediately preceding period of the same
          length, instead of 10 visually-identical cards. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {loading || !cards ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t("valueWon")}
              value={formatCurrency(cards.valueWon, defaultCurrency)}
              icon={DollarSign}
              delta={relativeDelta(cards.valueWon, previousCards?.valueWon ?? null, deltaLabels)}
            />
            <MetricCard
              title={t("dealsWon")}
              value={cards.dealsWon.toLocaleString()}
              icon={CheckCircle2}
              delta={relativeDelta(cards.dealsWon, previousCards?.dealsWon ?? null, deltaLabels)}
            />
            <MetricCard
              title={t("conversionRate")}
              value={fmtPct(cards.conversionRatePct)}
              icon={Percent}
              delta={pointsDelta(cards.conversionRatePct, previousCards?.conversionRatePct ?? null, deltaLabels)}
            />
            <MetricCard
              title={t("periodCommission")}
              value={formatCurrency(cards.commissionWon, defaultCurrency)}
              icon={Coins}
              delta={relativeDelta(cards.commissionWon, previousCards?.commissionWon ?? null, deltaLabels)}
            />
            <MetricCard
              title={t("avgTicket")}
              value={cards.avgTicket == null ? "—" : formatCurrency(cards.avgTicket, defaultCurrency)}
              icon={DollarSign}
              delta={relativeDelta(cards.avgTicket, previousCards?.avgTicket ?? null, deltaLabels)}
            />
          </>
        )}
      </div>

      {/* Secondary — context numbers that don't need their own
          full-size card: pipeline volume, operational pace, forecast. */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">{t("otherIndicators")}</p>
        {loading || !cards ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <CompactStat icon={Ticket} label={t("dealsCreated")} value={cards.dealsCreated.toLocaleString()} />
            <CompactStat icon={XCircle} label={t("dealsLost")} value={cards.dealsLost.toLocaleString()} />
            <CompactStat icon={CalendarClock} label={t("avgCloseTime")} value={fmtDays(cards.avgCloseDays)} />
            <CompactStat
              icon={Coins}
              label={t("projectedCommission")}
              value={formatCurrency(cards.commissionProjected, defaultCurrency)}
              hint={t("openDealsSubtitle")}
            />
            <CompactStat
              icon={Hourglass}
              label={t("avgTimeToWin")}
              value={fmtDays(bundle?.avgTimeToWinDays ?? null)}
              hint={t("avgTimeToWinTooltip")}
            />
          </div>
        )}
      </div>

      {bundle && <SalesGoalCard salesGoal={bundle.salesGoal} currency={defaultCurrency} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PipelineFunnelChart stages={bundle?.funnel ?? []} />
        <DealsPerDayChart data={bundle?.dealsPerDay ?? []} />
      </div>

      <PipelineLossReasonChart data={bundle?.lossByReason ?? []} currency={defaultCurrency} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TicketConversionBySourceTable rows={bundle?.conversionBySource ?? []} loading={loading} />
        <TicketConversionByCampaignTable rows={bundle?.conversionByCampaign ?? []} loading={loading} />
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

