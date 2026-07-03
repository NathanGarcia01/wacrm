"use client"

import { useEffect, useState } from "react"
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
        if (!cancelled) setError("Não foi possível carregar os dados de satisfação.")
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
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard title="Média geral" value={fmtRating(bundle.cards.avgRating)} icon={Star} />
            <MetricCard title="Pesquisas enviadas" value={bundle.cards.totalSent.toLocaleString()} icon={Send} />
            <MetricCard
              title="Pesquisas respondidas"
              value={bundle.cards.totalResponded.toLocaleString()}
              icon={MessageCircleHeart}
            />
            <MetricCard
              title="Taxa de resposta"
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
