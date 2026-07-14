"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import { DollarSign, Radio, Reply, Trophy, Users } from "lucide-react"
import { loadBroadcastsReport } from "@/lib/reports/broadcasts-queries"
import type { BroadcastsReportBundle, PeriodRange } from "@/lib/reports/types"
import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { BroadcastsTable } from "@/components/reports/broadcasts-table"
import { BroadcastRoiFunnelChart } from "@/components/reports/broadcast-roi-funnel-chart"

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}%`
}

export function BroadcastsTab({ period }: { period: PeriodRange }) {
  const t = useTranslations("reports.broadcastsTab")
  const { defaultCurrency } = useAuth()
  const [bundle, setBundle] = useState<BroadcastsReportBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    const db = createClient()
    loadBroadcastsReport(db, period)
      .then((b) => {
        if (!cancelled) setBundle(b)
      })
      .catch((err) => {
        console.error("[reports] broadcasts load failed:", err)
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading || !bundle ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard title={t("totalBroadcasts")} value={bundle.cards.totalBroadcasts.toLocaleString()} icon={Radio} />
            <MetricCard title={t("totalSent")} value={bundle.cards.totalSent.toLocaleString()} icon={Users} />
            <MetricCard
              title={t("uniqueContactsReached")}
              value={bundle.cards.uniqueContactsReached.toLocaleString()}
              icon={Users}
            />
            <MetricCard title={t("replyRate")} value={fmtPct(bundle.cards.replyRatePct)} icon={Reply} />
            <MetricCard title={t("dealsWon")} value={bundle.cards.dealsWon.toLocaleString()} icon={Trophy} />
            <MetricCard
              title={t("commissionGenerated")}
              value={formatCurrency(bundle.cards.commissionGenerated, defaultCurrency)}
              icon={DollarSign}
            />
          </>
        )}
      </div>

      <BroadcastRoiFunnelChart
        stages={
          bundle
            ? [
                { key: "sent", label: t("funnelSent"), value: bundle.funnel.sent },
                { key: "replied", label: t("funnelReplied"), value: bundle.funnel.replied },
                { key: "dealsCreated", label: t("funnelDealsCreated"), value: bundle.funnel.dealsCreated },
                { key: "dealsWon", label: t("funnelDealsWon"), value: bundle.funnel.dealsWon },
              ]
            : null
        }
        loading={loading}
        title={t("funnelTitle")}
      />

      <BroadcastsTable broadcasts={bundle?.broadcasts ?? []} loading={loading} />
    </div>
  )
}
