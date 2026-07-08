"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import { CheckCircle2, Clock, XCircle } from "lucide-react"
import { loadCommissionReport } from "@/lib/reports/commission-queries"
import type { CommissionReportBundle, CommissionStatusFilter, PeriodRange } from "@/lib/reports/types"
import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CommissionByMonthChart } from "@/components/reports/commission-by-month-chart"
import { CommissionsTable } from "@/components/reports/commissions-table"
import { CommissionAgentRankingTable } from "@/components/reports/commission-agent-ranking-table"

const STATUS_OPTIONS: CommissionStatusFilter[] = ["all", "open", "won", "lost"]

export function CommissionsTab({ period }: { period: PeriodRange }) {
  const t = useTranslations("reports.commissionsTab")
  const tDealStatus = useTranslations("reports.dealStatus")
  const { defaultCurrency } = useAuth()
  const [statusFilter, setStatusFilter] = useState<CommissionStatusFilter>("all")
  const [stageId, setStageId] = useState<string | null>(null)
  const [bundle, setBundle] = useState<CommissionReportBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    const db = createClient()
    loadCommissionReport(db, period, statusFilter, stageId)
      .then((b) => {
        if (!cancelled) setBundle(b)
      })
      .catch((err) => {
        console.error("[reports] commissions load failed:", err)
        if (!cancelled) setError(t("loadFailed"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period, statusFilter, stageId, t])

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("dealStatusLabel")}</label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as CommissionStatusFilter)}>
            <SelectTrigger className="w-44 bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o} value={o}>
                  {o === "all" ? t("statusAll") : tDealStatus(o)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("stageLabel")}</label>
          <Select
            value={stageId ?? "all"}
            onValueChange={(v) => setStageId(v === "all" ? null : v)}
          >
            <SelectTrigger className="w-48 bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStages")}</SelectItem>
              {(bundle?.stages ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {loading || !bundle ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t("commissionWon")}
              value={formatCurrency(bundle.cards.commissionWon, defaultCurrency)}
              icon={CheckCircle2}
            />
            <MetricCard
              title={t("commissionOpen")}
              value={formatCurrency(bundle.cards.commissionOpen, defaultCurrency)}
              icon={Clock}
            />
            <MetricCard
              title={t("commissionLost")}
              value={formatCurrency(bundle.cards.commissionLost, defaultCurrency)}
              icon={XCircle}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CommissionByMonthChart data={bundle?.byMonth ?? []} currency={defaultCurrency} />
        <CommissionAgentRankingTable
          rows={bundle?.agentRanking ?? []}
          loading={loading}
          currency={defaultCurrency}
        />
      </div>

      <CommissionsTable rows={bundle?.rows ?? []} loading={loading} />
    </div>
  )
}
