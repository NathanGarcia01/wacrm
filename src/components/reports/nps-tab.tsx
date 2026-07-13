"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { MessageCircleHeart, Percent, Send, Star } from "lucide-react"
import { loadNpsReport } from "@/lib/reports/nps-queries"
import type { NpsReportBundle, PeriodRange } from "@/lib/reports/types"
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    const db = createClient()
    loadNpsReport(db, period)
      .then((b) => {
        if (!cancelled) setBundle(b)
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !bundle ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard title={t("avgRating")} value={fmtRating(bundle.cards.avgRating)} icon={Star} />
            <MetricCard title={t("surveysSent")} value={bundle.cards.totalSent.toLocaleString()} icon={Send} />
            <MetricCard
              title={t("surveysResponded")}
              value={bundle.cards.totalResponded.toLocaleString()}
              icon={MessageCircleHeart}
            />
            <MetricCard
              title={t("responseRate")}
              value={fmtPct(bundle.cards.responseRatePct)}
              icon={Percent}
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
