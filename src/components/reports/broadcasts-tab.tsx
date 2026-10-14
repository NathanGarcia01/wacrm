"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import { DollarSign, Radio, Reply, Trophy, Users } from "lucide-react"
import { loadBroadcastsReport } from "@/lib/reports/broadcasts-queries"
import { previousPeriod } from "@/lib/reports/period"
import { relativeDelta, pointsDelta, type DeltaLabels } from "@/lib/reports/delta"
import type { BroadcastReportCards, BroadcastsReportBundle, PeriodRange } from "@/lib/reports/types"
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
  const [previousCards, setPreviousCards] = useState<BroadcastReportCards | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const deltaLabels: DeltaLabels = {
    vsPrevious: t("vsPreviousPeriod"),
    new: t("newVsPreviousPeriod"),
    flat: t("flatVsPreviousPeriod"),
  }

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    const db = createClient()
    Promise.all([
      loadBroadcastsReport(db, period),
      loadBroadcastsReport(db, { ...period, ...previousPeriod(period) }),
    ])
      .then(([b, prev]) => {
        if (cancelled) return
        setBundle(b)
        setPreviousCards(prev.cards)
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {loading || !bundle ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t("totalSent")}
              value={bundle.cards.totalSent.toLocaleString()}
              icon={Users}
              delta={relativeDelta(bundle.cards.totalSent, previousCards?.totalSent ?? null, deltaLabels)}
            />
            <MetricCard
              title={t("uniqueContactsReached")}
              value={bundle.cards.uniqueContactsReached.toLocaleString()}
              icon={Users}
              delta={relativeDelta(
                bundle.cards.uniqueContactsReached,
                previousCards?.uniqueContactsReached ?? null,
                deltaLabels,
              )}
            />
            <MetricCard
              title={t("replyRate")}
              value={fmtPct(bundle.cards.replyRatePct)}
              icon={Reply}
              delta={pointsDelta(bundle.cards.replyRatePct, previousCards?.replyRatePct ?? null, deltaLabels)}
            />
            <MetricCard
              title={t("dealsWon")}
              value={bundle.cards.dealsWon.toLocaleString()}
              icon={Trophy}
              delta={relativeDelta(bundle.cards.dealsWon, previousCards?.dealsWon ?? null, deltaLabels)}
            />
            <MetricCard
              title={t("commissionGenerated")}
              value={formatCurrency(bundle.cards.commissionGenerated, defaultCurrency)}
              icon={DollarSign}
              delta={relativeDelta(
                bundle.cards.commissionGenerated,
                previousCards?.commissionGenerated ?? null,
                deltaLabels,
              )}
            />
          </>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">{t("otherIndicators")}</p>
        {loading || !bundle ? (
          <div className="h-10 w-32 animate-pulse rounded-md bg-muted" />
        ) : (
          <div className="flex items-start gap-2">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Radio className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{t("totalBroadcasts")}</p>
              <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
                {bundle.cards.totalBroadcasts.toLocaleString()}
              </p>
            </div>
          </div>
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
        insight={
          bundle && bundle.funnel.sent > 0
            ? t("funnelInsight", { pct: ((bundle.funnel.dealsWon / bundle.funnel.sent) * 100).toFixed(1) })
            : undefined
        }
      />

      <BroadcastsTable broadcasts={bundle?.broadcasts ?? []} loading={loading} />
    </div>
  )
}
