"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { CheckCircle2, Percent, Radio, Reply, Users, XCircle } from "lucide-react"
import { loadBroadcastsReport } from "@/lib/reports/broadcasts-queries"
import type { BroadcastsReportBundle, PeriodRange } from "@/lib/reports/types"
import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { BroadcastsTable } from "@/components/reports/broadcasts-table"

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}%`
}

export function BroadcastsTab({ period }: { period: PeriodRange }) {
  const t = useTranslations("reports.broadcastsTab")
  const [bundle, setBundle] = useState<BroadcastsReportBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
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
            <MetricCard title={t("uniqueRecipients")} value={bundle.cards.uniqueRecipients.toLocaleString()} icon={Users} />
            <MetricCard title={t("delivered")} value={bundle.cards.delivered.toLocaleString()} icon={CheckCircle2} />
            <MetricCard title={t("failed")} value={bundle.cards.failed.toLocaleString()} icon={XCircle} />
            <MetricCard title={t("deliveryRate")} value={fmtPct(bundle.cards.deliveryRatePct)} icon={Percent} />
            <MetricCard title={t("replyRate")} value={fmtPct(bundle.cards.replyRatePct)} icon={Reply} />
          </>
        )}
      </div>

      <BroadcastsTable broadcasts={bundle?.broadcasts ?? []} loading={loading} />
    </div>
  )
}
