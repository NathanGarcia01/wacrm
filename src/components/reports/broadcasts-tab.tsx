"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import { DollarSign, Radio, Reply, Trophy, Users } from "lucide-react"
import { loadBroadcastsReport } from "@/lib/reports/broadcasts-queries"
import { previousPeriod } from "@/lib/reports/period"
import { gatedRelativeDelta, withShortLabel, pointsDelta, type DeltaLabels } from "@/lib/reports/delta"
import { formatPercent } from "@/lib/reports/format"
import type { BroadcastReportCards, BroadcastsReportBundle, PeriodRange } from "@/lib/reports/types"
import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { CompactStat } from "@/components/reports/compact-stat"
import { BroadcastsTable } from "@/components/reports/broadcasts-table"
import { BroadcastRoiFunnelChart } from "@/components/reports/broadcast-roi-funnel-chart"

/** "de N no período (Y%)" honesty line for the dealsWon/commission
 *  cards — both only ever show the slice attributed to a broadcast
 *  touch, never the account's full win count, so every card next to
 *  it must say what fraction of the real total it represents. */
function sharePct(part: number, total: number): number | null {
  return total > 0 ? (part / total) * 100 : null
}

function formatCountAbsolute(unit: string) {
  return (current: number, previous: number) => {
    const diff = current - previous
    return `${diff > 0 ? "+" : ""}${diff.toLocaleString()} ${unit}`
  }
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
  const gateCount = previousCards?.totalSent ?? 0

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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {loading || !bundle ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t("totalSent")}
              value={bundle.cards.totalSent.toLocaleString()}
              icon={Users}
              delta={gatedRelativeDelta(
                bundle.cards.totalSent,
                previousCards?.totalSent ?? null,
                gateCount,
                deltaLabels,
                formatCountAbsolute(t("totalSent")),
              )}
            />
            <MetricCard
              title={t("uniqueContactsReached")}
              value={bundle.cards.uniqueContactsReached.toLocaleString()}
              icon={Users}
              delta={gatedRelativeDelta(
                bundle.cards.uniqueContactsReached,
                previousCards?.uniqueContactsReached ?? null,
                gateCount,
                deltaLabels,
                formatCountAbsolute(t("uniqueContactsReached")),
              )}
            />
            <MetricCard
              title={t("replyRate")}
              value={formatPercent(bundle.cards.replyRatePct)}
              icon={Reply}
              delta={
                gateCount < 5
                  ? undefined
                  : withShortLabel(
                      pointsDelta(bundle.cards.replyRatePct, previousCards?.replyRatePct ?? null, deltaLabels),
                      deltaLabels.vsPrevious,
                    )
              }
              subtitle={gateCount < 5 ? t("noComparisonBase") : undefined}
            />
            {/* No `delta` here on purpose — the honesty disclosure
                (what slice of the period's real total this is) matters
                more than a vs-previous-period trend, and MetricCard only
                renders one of the two (delta takes priority over subtitle). */}
            <MetricCard
              title={t("dealsWon")}
              value={bundle.cards.dealsWon.toLocaleString()}
              icon={Trophy}
              subtitle={t("attributedShareSubtitle", {
                total: bundle.cards.periodTotalDealsWon.toLocaleString(),
                pct: formatPercent(sharePct(bundle.cards.dealsWon, bundle.cards.periodTotalDealsWon)),
              })}
            />
            <MetricCard
              title={t("commissionGenerated")}
              value={formatCurrency(bundle.cards.commissionGenerated, defaultCurrency)}
              icon={DollarSign}
              subtitle={t("attributedShareSubtitle", {
                total: formatCurrency(bundle.cards.periodTotalCommission, defaultCurrency),
                pct: formatPercent(sharePct(bundle.cards.commissionGenerated, bundle.cards.periodTotalCommission)),
              })}
            />
          </>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">{t("otherIndicators")}</p>
        {loading || !bundle ? (
          <div className="h-10 w-32 animate-pulse rounded-md bg-muted" />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CompactStat
              icon={Radio}
              label={t("totalBroadcasts")}
              value={bundle.cards.totalBroadcasts.toLocaleString()}
            />
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
            ? t("funnelInsight", {
                pct: new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
                  (bundle.funnel.dealsWon / bundle.funnel.sent) * 100,
                ),
              })
            : undefined
        }
      />

      <BroadcastsTable broadcasts={bundle?.broadcasts ?? []} loading={loading} />
    </div>
  )
}
