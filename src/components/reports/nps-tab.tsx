"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { MessageCircleHeart, Percent, Send, Star } from "lucide-react"
import { loadNpsReport } from "@/lib/reports/nps-queries"
import { previousPeriod } from "@/lib/reports/period"
import { gatedRelativeDelta, withShortLabel, pointsDelta, type DeltaLabels } from "@/lib/reports/delta"
import type { NpsReportBundle, NpsReportCards, PeriodRange } from "@/lib/reports/types"
import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { NpsDistributionChart } from "@/components/reports/nps-distribution-chart"
import { NpsTrendChart } from "@/components/reports/nps-trend-chart"
import { NpsReviewsTable } from "@/components/reports/nps-reviews-table"
import { NpsAgentRankingTable } from "@/components/reports/nps-agent-ranking-table"

function fmtRating(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)} / 5`
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}%`
}

export function NpsTab({ period }: { period: PeriodRange }) {
  const t = useTranslations("reports.npsTab")
  const [bundle, setBundle] = useState<NpsReportBundle | null>(null)
  const [previousCards, setPreviousCards] = useState<NpsReportCards | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const deltaLabels: DeltaLabels = {
    vsPrevious: t("vsPreviousPeriod"),
    new: t("newVsPreviousPeriod"),
    flat: t("flatVsPreviousPeriod"),
  }
  const formatRatingAbsolute = (current: number, previous: number) =>
    `${previous.toFixed(1)} → ${current.toFixed(1)}`
  const formatCountAbsolute = (unit: string) => (current: number, previous: number) => {
    const diff = current - previous
    return `${diff > 0 ? "+" : ""}${diff.toLocaleString()} ${unit}`
  }

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    const db = createClient()
    Promise.all([
      loadNpsReport(db, period),
      loadNpsReport(db, { ...period, ...previousPeriod(period) }),
    ])
      .then(([b, prev]) => {
        if (cancelled) return
        setBundle(b)
        setPreviousCards(prev.cards)
      })
      .catch((err) => {
        console.error("[reports] nps load failed:", err)
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {loading || !bundle ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t("avgRating")}
              value={fmtRating(bundle.cards.avgRating)}
              icon={Star}
              delta={gatedRelativeDelta(
                bundle.cards.avgRating,
                previousCards?.avgRating ?? null,
                previousCards?.totalSent ?? 0,
                deltaLabels,
                formatRatingAbsolute,
              )}
            />
            <MetricCard
              title={t("surveysSent")}
              value={bundle.cards.totalSent.toLocaleString()}
              icon={Send}
              delta={gatedRelativeDelta(
                bundle.cards.totalSent,
                previousCards?.totalSent ?? null,
                previousCards?.totalSent ?? 0,
                deltaLabels,
                formatCountAbsolute(t("surveysUnit")),
              )}
            />
            <MetricCard
              title={t("surveysResponded")}
              value={bundle.cards.totalResponded.toLocaleString()}
              icon={MessageCircleHeart}
              delta={gatedRelativeDelta(
                bundle.cards.totalResponded,
                previousCards?.totalResponded ?? null,
                previousCards?.totalSent ?? 0,
                deltaLabels,
                formatCountAbsolute(t("responsesUnit")),
              )}
            />
            <MetricCard
              title={t("responseRate")}
              value={fmtPct(bundle.cards.responseRatePct)}
              icon={Percent}
              delta={
                (previousCards?.totalSent ?? 0) < 5
                  ? undefined
                  : withShortLabel(
                      pointsDelta(bundle.cards.responseRatePct, previousCards?.responseRatePct ?? null, deltaLabels),
                      deltaLabels.vsPrevious,
                    )
              }
              subtitle={(previousCards?.totalSent ?? 0) < 5 ? t("noComparisonBase") : undefined}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <NpsDistributionChart data={bundle?.distribution ?? []} />
        <NpsTrendChart data={bundle?.trend ?? []} />
      </div>

      <NpsAgentRankingTable rows={bundle?.agentRanking ?? []} loading={loading} />
      <NpsReviewsTable reviews={bundle?.reviews ?? []} loading={loading} />
    </div>
  )
}
