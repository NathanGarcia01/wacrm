"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { localeToIntl, type Locale } from "@/i18n/locales"
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
import {
  loadDailyPipelineSparkSeries,
  loadFunnelCohortDeals,
  loadPipelineCards,
  loadPipelineReport,
  loadPipelineStages,
  loadStageReachByDeal,
  loadWonStageIds,
  type FunnelCohortDeal,
} from "@/lib/reports/pipeline-queries"
import { samePeriodLastMonth } from "@/lib/reports/period"
import { gatedRelativeDelta, pointsDelta, withShortLabel, type DeltaLabels } from "@/lib/reports/delta"
import type {
  PeriodRange,
  PipelineDailySparkPoint,
  PipelineReportBundle,
  PipelineReportCards,
  PipelineStageMeta,
} from "@/lib/reports/types"
import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { CompactStat } from "@/components/reports/compact-stat"
import { PipelineFunnelChart, type PipelineFunnelStep } from "@/components/reports/pipeline-funnel-chart"
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

/** "outubro" for a 'month' period (parsed from `fromDate`'s UTC date
 *  parts so no local-timezone shift can roll it into the adjacent
 *  month), null for any other period key — the funnel subtitle falls
 *  back to a period-agnostic phrasing in that case. */
function periodMonthLabel(period: PeriodRange, intlLocale: string): string | null {
  if (period.key !== "month") return null
  const [y, m] = period.fromDate.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1, 12))
  return new Intl.DateTimeFormat(intlLocale, { month: "long", timeZone: "UTC" }).format(d)
}

function fmtDays(v: number | null, intlLocale: string, unit: string): string {
  if (v == null) return "—"
  return `${v.toLocaleString(intlLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}`
}

/** Per-day values for a KPI's sparkline, derived purely by resampling
 *  the already-fetched won/lost deal rows — no new aggregation. */
function sparkFor(series: PipelineDailySparkPoint[], metric: "valueWon" | "dealsWon" | "conversion" | "avgTicket") {
  return series.map((p) => {
    switch (metric) {
      case "valueWon":
        return p.wonValue
      case "dealsWon":
        return p.wonCount
      case "conversion":
        return p.wonCount + p.lostCount > 0 ? (p.wonCount / (p.wonCount + p.lostCount)) * 100 : NaN
      case "avgTicket":
        return p.wonCount > 0 ? p.wonValue / p.wonCount : NaN
    }
  })
}

export function PipelineTab({ period }: { period: PeriodRange }) {
  const t = useTranslations("reports.pipelineTab")
  const tFunnel = useTranslations("reports.pipelineFunnelChart")
  const intlLocale = localeToIntl(useLocale() as Locale)
  const deltaLabels: DeltaLabels = {
    vsPrevious: t("vsSameMonthLastPeriod"),
    new: t("newVsSameMonthLastPeriod"),
    flat: t("flatVsSameMonthLastPeriod"),
  }
  const { account, defaultCurrency } = useAuth()
  const formatCountAbsolute = (current: number, previous: number) => {
    const diff = current - previous
    return `${diff > 0 ? "+" : ""}${diff.toLocaleString()} ${t("dealsUnit")}`
  }
  const formatCurrencyAbsolute = (current: number, previous: number) =>
    `${formatCurrency(previous, defaultCurrency)} → ${formatCurrency(current, defaultCurrency)}`
  /** Mobile-only short form — "R$ X → R$ Y" gets clipped in a narrow
   *  2-column KPI card, so the diff alone ("+R$ 48.084") is what's
   *  shown below the `sm` breakpoint. */
  const formatCurrencyAbsoluteShort = (current: number, previous: number) => {
    const diff = current - previous
    return `${diff > 0 ? "+" : ""}${formatCurrency(diff, defaultCurrency)}`
  }
  const accountId = account?.id ?? null
  const timezone = account?.timezone ?? "America/Sao_Paulo"
  const [bundle, setBundle] = useState<PipelineReportBundle | null>(null)
  const [sameMonthCards, setSameMonthCards] = useState<PipelineReportCards | null>(null)
  const [sparkSeries, setSparkSeries] = useState<PipelineDailySparkPoint[]>([])
  const [stages, setStages] = useState<PipelineStageMeta[]>([])
  const [wonStageIds, setWonStageIds] = useState<Set<string>>(new Set())
  const [stageReach, setStageReach] = useState<Map<string, Set<string>>>(new Map())
  const [cohortDeals, setCohortDeals] = useState<FunnelCohortDeal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Stage structure + event-derived stage history don't depend on the
  // selected period — fetched once per account instead of refetching
  // on every period change.
  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    const db = createClient()
    Promise.all([loadPipelineStages(db, accountId), loadWonStageIds(db, accountId), loadStageReachByDeal(db, accountId)])
      .then(([s, won, reach]) => {
        if (cancelled) return
        setStages(s)
        setWonStageIds(won)
        setStageReach(reach)
      })
      .catch((err) => console.error("[reports] pipeline stages load failed:", err))
    return () => {
      cancelled = true
    }
  }, [accountId])

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    const db = createClient()
    Promise.all([
      loadPipelineReport(db, period, accountId, timezone),
      loadPipelineCards(db, samePeriodLastMonth(period), accountId),
      loadDailyPipelineSparkSeries(db, period, accountId, timezone),
      loadFunnelCohortDeals(db, period, accountId),
    ])
      .then(([b, prevCards, spark, cohort]) => {
        if (cancelled) return
        setBundle(b)
        setSameMonthCards(prevCards)
        setSparkSeries(spark)
        setCohortDeals(cohort)
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

  /** Cumulative stage-reach funnel for the cohort of deals CREATED in
   *  the period: how many of them reached each forward stage or
   *  further, regardless of current status — not the live open-
   *  pipeline snapshot the RPC's `funnel` field holds. Per deal, the
   *  furthest position reached is: every forward stage (won deals
   *  reach them all), else the max position among deal_events'
   *  to_stage_id for that deal when any exist, else the deal's
   *  CURRENT stage position as the best available proxy. Loss
   *  pseudo-stages (position >= wonPosition, e.g. "Perdido"/"Sem
   *  margem") are never counted as progress. */
  const { funnelSteps, funnelSubtitle } = useMemo((): {
    funnelSteps: PipelineFunnelStep[]
    funnelSubtitle: string | null
  } => {
    const empty = { funnelSteps: [], funnelSubtitle: null }
    if (stages.length === 0 || cohortDeals.length === 0) return empty

    let activePipelineId: string | null = null
    for (const s of stages) {
      if (wonStageIds.has(s.id)) {
        activePipelineId = s.pipelineId
        break
      }
    }
    if (!activePipelineId) {
      const counts = new Map<string, number>()
      for (const s of stages) counts.set(s.pipelineId, (counts.get(s.pipelineId) ?? 0) + 1)
      activePipelineId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    }
    if (!activePipelineId) return empty

    const activeStages = stages.filter((s) => s.pipelineId === activePipelineId).sort((a, b) => a.position - b.position)
    if (activeStages.length === 0) return empty

    const wonPositions = activeStages.filter((s) => wonStageIds.has(s.id)).map((s) => s.position)
    const wonPosition = wonPositions.length > 0 ? Math.max(...wonPositions) : activeStages[activeStages.length - 1].position
    const positionByStageId = new Map(activeStages.map((s) => [s.id, s.position]))
    const forwardStages = activeStages.filter((s) => s.position < wonPosition)

    const reachCounts = new Map<number, number>(forwardStages.map((s) => [s.position, 0]))
    let wonCount = 0

    for (const deal of cohortDeals) {
      if (deal.status === "won") {
        wonCount++
        for (const s of forwardStages) reachCounts.set(s.position, (reachCounts.get(s.position) ?? 0) + 1)
        continue
      }

      let maxPos = -1
      const touched = stageReach.get(deal.id)
      if (touched) {
        for (const stageId of touched) {
          const pos = positionByStageId.get(stageId)
          if (pos != null && pos < wonPosition) maxPos = Math.max(maxPos, pos)
        }
      }
      if (maxPos < 0) {
        const curPos = deal.stageId ? positionByStageId.get(deal.stageId) : undefined
        maxPos = curPos != null && curPos < wonPosition ? curPos : 0
      }

      for (const s of forwardStages) {
        if (s.position <= maxPos) reachCounts.set(s.position, (reachCounts.get(s.position) ?? 0) + 1)
      }
    }

    const progressSteps: PipelineFunnelStep[] = forwardStages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      count: reachCounts.get(s.position) ?? 0,
    }))
    progressSteps.push({ id: "__won", name: tFunnel("wonStep"), color: "var(--primary)", count: wonCount })

    const monthLabel = periodMonthLabel(period, intlLocale)
    const subtitle =
      monthLabel != null
        ? t("funnelCohortMonth", { created: cohortDeals.length, won: wonCount, month: monthLabel })
        : t("funnelCohortPeriod", { created: cohortDeals.length, won: wonCount })

    return { funnelSteps: progressSteps, funnelSubtitle: subtitle }
  }, [stages, wonStageIds, stageReach, cohortDeals, tFunnel, period, intlLocale, t])

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Headline — the 4 numbers that answer "how did sales go",
          each compared against the same calendar days last month
          (not the immediately-preceding window), with a sparkline of
          its own daily shape across the period. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {loading || !cards ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t("valueWon")}
              value={formatCurrency(cards.valueWon, defaultCurrency)}
              icon={DollarSign}
              highlight
              delta={gatedRelativeDelta(
                cards.valueWon,
                sameMonthCards?.valueWon ?? null,
                sameMonthCards?.dealsWon ?? 0,
                deltaLabels,
                formatCurrencyAbsolute,
                true,
                formatCurrencyAbsoluteShort,
              )}
              sparkline={sparkFor(sparkSeries, "valueWon")}
            />
            <MetricCard
              title={t("dealsWon")}
              value={cards.dealsWon.toLocaleString()}
              icon={CheckCircle2}
              delta={gatedRelativeDelta(
                cards.dealsWon,
                sameMonthCards?.dealsWon ?? null,
                sameMonthCards?.dealsWon ?? 0,
                deltaLabels,
                formatCountAbsolute,
              )}
              sparkline={sparkFor(sparkSeries, "dealsWon")}
            />
            <MetricCard
              title={t("conversionRate")}
              value={fmtPct(cards.conversionRatePct)}
              icon={Percent}
              delta={
                (sameMonthCards?.dealsWon ?? 0) < 5
                  ? undefined
                  : withShortLabel(
                      pointsDelta(cards.conversionRatePct, sameMonthCards?.conversionRatePct ?? null, deltaLabels),
                      deltaLabels.vsPrevious,
                    )
              }
              subtitle={(sameMonthCards?.dealsWon ?? 0) < 5 ? t("noComparisonBase") : undefined}
              sparkline={sparkFor(sparkSeries, "conversion")}
            />
            <MetricCard
              title={t("avgTicket")}
              value={cards.avgTicket == null ? "—" : formatCurrency(cards.avgTicket, defaultCurrency)}
              icon={DollarSign}
              delta={gatedRelativeDelta(
                cards.avgTicket,
                sameMonthCards?.avgTicket ?? null,
                sameMonthCards?.dealsWon ?? 0,
                deltaLabels,
                formatCurrencyAbsolute,
                true,
                formatCurrencyAbsoluteShort,
              )}
              sparkline={sparkFor(sparkSeries, "avgTicket")}
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
            <CompactStat
              icon={CalendarClock}
              label={t("avgCloseTime")}
              value={fmtDays(cards.avgCloseDays, intlLocale, t("daysUnit"))}
            />
            <CompactStat
              icon={Coins}
              label={t("commissionGenerated")}
              value={formatCurrency(cards.commissionWon, defaultCurrency)}
              className="text-primary"
            />
            <CompactStat
              icon={Hourglass}
              label={t("avgTimeToWin")}
              value={fmtDays(bundle?.avgTimeToWinDays ?? null, intlLocale, t("daysUnit"))}
              hint={t("avgTimeToWinTooltip")}
            />
          </div>
        )}
      </div>

      <PipelineFunnelChart steps={funnelSteps} subtitle={funnelSubtitle} />

      <DealsPerDayChart data={bundle?.dealsPerDay ?? []} />

      {bundle && <SalesGoalCard salesGoal={bundle.salesGoal} currency={defaultCurrency} timezone={timezone} />}

      <PipelineLossReasonChart data={bundle?.lossByReason ?? []} currency={defaultCurrency} />

      <TicketConversionBySourceTable rows={bundle?.conversionBySource ?? []} loading={loading} />

      <TicketConversionByCampaignTable
        rows={bundle?.conversionByCampaign ?? []}
        loading={loading}
        currency={defaultCurrency}
        totalDealsWon={cards?.dealsWon ?? 0}
      />

      <CommissionAgentRankingTable
        rows={bundle?.commissionByAgent ?? []}
        loading={loading}
        currency={defaultCurrency}
      />

      <DealsTable deals={bundle?.deals ?? []} loading={loading} />
    </div>
  )
}
