"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import { DollarSign, TrendingUp, TrendingDown, Users, Target, Percent, Ticket, Clock } from "lucide-react"
import { loadBroadcastRoiReport } from "@/lib/reports/broadcast-roi-queries"
import { previousPeriod } from "@/lib/reports/period"
import { relativeDelta, pointsDelta, type DeltaLabels } from "@/lib/reports/delta"
import type { BroadcastRoiBundle, BroadcastRoiCards, PeriodRange } from "@/lib/reports/types"
import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { CompactStat } from "@/components/reports/compact-stat"
import { BroadcastRoiFunnelChart } from "./broadcast-roi-funnel-chart"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function BroadcastRoiTab({ period }: { period: PeriodRange }) {
  const t = useTranslations("reports.broadcastRoiTab")
  const { defaultCurrency } = useAuth()
  const [bundle, setBundle] = useState<BroadcastRoiBundle | null>(null)
  const [previousCards, setPreviousCards] = useState<BroadcastRoiCards | null>(null)
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
      loadBroadcastRoiReport(db, period),
      loadBroadcastRoiReport(db, { ...period, ...previousPeriod(period) }),
    ])
      .then(([b, prev]) => {
        if (cancelled) return
        setBundle(b)
        setPreviousCards(prev.cards)
      })
      .catch((err) => {
        console.error("[reports] broadcast ROI load failed:", err)
        if (!cancelled) setError(t("loadFailed"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period, t])

  const positive = (bundle?.cards.roiPct ?? 0) >= 0

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Headline ROI card — full width, colored by sign. */}
      {loading || !bundle ? (
        <SkeletonCard />
      ) : (
        <div
          className={`rounded-xl border p-5 ${
            positive ? "border-primary/30 bg-primary/10" : "border-destructive/30 bg-destructive/10"
          }`}
        >
          <div className="flex items-center gap-2">
            {positive ? (
              <TrendingUp className="h-5 w-5 text-primary" />
            ) : (
              <TrendingDown className="h-5 w-5 text-destructive" />
            )}
            <span className="text-sm font-medium text-muted-foreground">{t("roi")}</span>
          </div>
          <p
            className={`mt-1 font-mono text-4xl font-bold ${positive ? "text-primary" : "text-destructive"}`}
          >
            {bundle.cards.roiPct == null ? "—" : `${bundle.cards.roiPct.toFixed(0)}%`}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-xs text-muted-foreground">{t("roiSubtitle")}</p>
            {(() => {
              const delta = pointsDelta(bundle.cards.roiPct, previousCards?.roiPct ?? null, deltaLabels)
              return delta ? (
                <span
                  className={`font-mono text-xs ${
                    delta.sign > 0 ? "text-primary" : delta.sign < 0 ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {delta.label}
                </span>
              ) : null
            })()}
          </div>
        </div>
      )}

      {/* Headline — commission, leads, and conversion, each with a
          trend vs. the immediately preceding period. Cost/multiple/
          avg-ticket/avg-days move together with these and stay in the
          secondary strip instead of repeating the same story. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !bundle ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t("commissionGenerated")}
              value={formatCurrency(bundle.cards.commissionGenerated, defaultCurrency)}
              icon={TrendingUp}
              delta={relativeDelta(
                bundle.cards.commissionGenerated,
                previousCards?.commissionGenerated ?? null,
                deltaLabels,
              )}
            />
            <MetricCard
              title={t("leadsGenerated")}
              value={bundle.cards.leadsGenerated.toLocaleString()}
              icon={Users}
              delta={relativeDelta(bundle.cards.leadsGenerated, previousCards?.leadsGenerated ?? null, deltaLabels)}
            />
            <MetricCard
              title={t("conversionRate")}
              value={bundle.cards.conversionRatePct == null ? "—" : `${bundle.cards.conversionRatePct.toFixed(0)}%`}
              icon={Percent}
              subtitle={t("dealsWon") + ": " + bundle.cards.dealsWon.toLocaleString()}
              delta={pointsDelta(
                bundle.cards.conversionRatePct,
                previousCards?.conversionRatePct ?? null,
                deltaLabels,
              )}
            />
            <MetricCard
              title={t("costTotal")}
              value={formatCurrency(bundle.cards.cost.total, defaultCurrency)}
              icon={DollarSign}
              subtitle={t("costBreakdown", {
                marketing: formatCurrency(bundle.cards.cost.marketing, defaultCurrency),
                utility: formatCurrency(bundle.cards.cost.utility, defaultCurrency),
                authentication: formatCurrency(bundle.cards.cost.authentication, defaultCurrency),
              })}
            />
          </>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">{t("otherIndicators")}</p>
        {loading || !bundle ? (
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CompactStat
              icon={Target}
              label={t("multiple")}
              value={bundle.cards.multiple == null ? "—" : `${bundle.cards.multiple.toFixed(1)}x`}
            />
            <CompactStat
              icon={Ticket}
              label={t("avgCommissionPerDeal")}
              value={
                bundle.cards.avgCommissionPerDeal == null
                  ? "—"
                  : formatCurrency(bundle.cards.avgCommissionPerDeal, defaultCurrency)
              }
            />
            <CompactStat
              icon={Clock}
              label={t("avgDaysToClose")}
              value={
                bundle.cards.avgDaysToClose == null
                  ? "—"
                  : t("avgDaysToCloseValue", { days: bundle.cards.avgDaysToClose.toFixed(1) })
              }
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
            ? t("funnelInsight", { pct: ((bundle.funnel.dealsWon / bundle.funnel.sent) * 100).toFixed(1) })
            : undefined
        }
      />

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t("tableTitle")}</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colBroadcast")}</TableHead>
              <TableHead>{t("colCategory")}</TableHead>
              <TableHead className="text-right">{t("colSent")}</TableHead>
              <TableHead className="text-right">{t("colCost")}</TableHead>
              <TableHead className="text-right">{t("colDealsWon")}</TableHead>
              <TableHead className="text-right">{t("colCommission")}</TableHead>
              <TableHead className="text-right">{t("colRoi")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  {t("loading")}…
                </TableCell>
              </TableRow>
            ) : !bundle || bundle.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              bundle.rows.map((row) => {
                const rowPositive = (row.roiPct ?? 0) >= 0
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">{row.templateCategory ?? "—"}</TableCell>
                    <TableCell className="font-mono text-right tabular-nums">
                      {row.sentCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-right tabular-nums">
                      {formatCurrency(row.cost, defaultCurrency)}
                    </TableCell>
                    <TableCell className="font-mono text-right tabular-nums">{row.dealsWon}</TableCell>
                    <TableCell className="font-mono text-right tabular-nums text-gold">
                      {formatCurrency(row.commissionGenerated, defaultCurrency)}
                    </TableCell>
                    <TableCell
                      className={`font-mono text-right tabular-nums ${
                        rowPositive ? "text-primary" : "text-destructive"
                      }`}
                    >
                      {row.roiPct == null ? "—" : `${row.roiPct.toFixed(0)}%`}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
