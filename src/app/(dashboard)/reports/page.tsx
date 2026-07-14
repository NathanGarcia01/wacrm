"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import { Clock, DollarSign, MessageSquare, MessageSquareReply, Percent, Trophy, Users } from "lucide-react"

import { loadReportsBundle } from "@/lib/reports/queries"
import { resolvePeriod } from "@/lib/reports/period"
import { formatResponseTime } from "@/lib/reports/format"
import type { PeriodKey, ReportsBundle } from "@/lib/reports/types"

import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { PeriodFilter } from "@/components/reports/period-filter"
import { UserRankingTable } from "@/components/reports/user-ranking-table"
import { MessagesPerDayChart } from "@/components/reports/messages-per-day-chart"
import { PipelineTab } from "@/components/reports/pipeline-tab"
import { BroadcastsTab } from "@/components/reports/broadcasts-tab"
import { BroadcastRoiTab } from "@/components/reports/broadcast-roi-tab"
import { QualityTab } from "@/components/reports/quality-tab"
import { NpsTab } from "@/components/reports/nps-tab"
import { CommissionsTab } from "@/components/reports/commissions-tab"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type ReportTab =
  | "overview"
  | "pipeline"
  | "broadcasts"
  | "broadcastRoi"
  | "quality"
  | "satisfaction"
  | "commissions"

function isPeriodKey(v: string | null): v is PeriodKey {
  return v === "today" || v === "week" || v === "month" || v === "custom"
}

function isReportTab(v: string | null): v is ReportTab {
  return (
    v === "overview" ||
    v === "pipeline" ||
    v === "broadcasts" ||
    v === "broadcastRoi" ||
    v === "quality" ||
    v === "satisfaction" ||
    v === "commissions"
  )
}

// `useSearchParams` opts the page out of static prerendering unless
// it sits under a Suspense boundary — same split used by
// (auth)/login/page.tsx.
export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsPageInner />
    </Suspense>
  )
}

function ReportsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { defaultCurrency } = useAuth()

  const tabParam = searchParams.get("tab")
  const tab: ReportTab = isReportTab(tabParam) ? tabParam : "overview"

  const periodParam = searchParams.get("period")
  // The Transmissões report reads better zoomed out (a single day of
  // broadcast activity is rarely representative) — defaults to "week"
  // when no period is in the URL; every other tab keeps "today".
  const defaultPeriodKey: PeriodKey = tab === "broadcasts" ? "week" : "today"
  const periodKey: PeriodKey = isPeriodKey(periodParam) ? periodParam : defaultPeriodKey
  const fromParam = searchParams.get("from")
  const toParam = searchParams.get("to")

  const period = useMemo(
    () => resolvePeriod(periodKey, fromParam, toParam),
    [periodKey, fromParam, toParam],
  )

  const [bundle, setBundle] = useState<ReportsBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Re-fetch whenever the resolved period changes. Resetting
  // loading/error synchronously here (rather than only inside the
  // promise callbacks below) is what makes switching periods show a
  // fresh skeleton instead of stale data while the new query runs.
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    const db = createClient()
    loadReportsBundle(db, period)
      .then((b) => {
        if (!cancelled) setBundle(b)
      })
      .catch((err) => {
        console.error("[reports] load failed:", err)
        if (!cancelled) setError("Não foi possível carregar os relatórios.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period])

  function buildParams(next: { tab?: ReportTab; period: PeriodKey; from?: string; to?: string }) {
    const params = new URLSearchParams()
    params.set("tab", next.tab ?? tab)
    params.set("period", next.period)
    if (next.period === "custom" && next.from && next.to) {
      params.set("from", next.from)
      params.set("to", next.to)
    }
    return params
  }

  function updatePeriod(next: { period: PeriodKey; from?: string; to?: string }) {
    router.replace(`/reports?${buildParams(next).toString()}`, { scroll: false })
  }

  function updateTab(next: ReportTab) {
    router.replace(
      `/reports?${buildParams({ tab: next, period: periodKey, from: fromParam ?? undefined, to: toParam ?? undefined }).toString()}`,
      { scroll: false },
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Relatórios</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Métricas de atendimento, vendas, transmissões e qualidade da conta por período.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => updateTab(v as ReportTab)}>
          <TabsList>
            <TabsTrigger value="overview">Visão geral</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline &amp; Vendas</TabsTrigger>
            <TabsTrigger value="commissions">Comissões</TabsTrigger>
            <TabsTrigger value="broadcasts">Transmissões</TabsTrigger>
            <TabsTrigger value="broadcastRoi">ROI de Transmissões</TabsTrigger>
            <TabsTrigger value="quality">Qualidade da conta</TabsTrigger>
            <TabsTrigger value="satisfaction">Satisfação</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <PeriodFilter period={period} onChange={updatePeriod} />

      {tab === "overview" && (
        <div className="space-y-5">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {loading || !bundle ? (
              Array.from({ length: 7 }).map((_, i) => <SkeletonCard key={i} />)
            ) : (
              <>
                <MetricCard
                  title="Mensagens enviadas"
                  value={bundle.cards.messagesSent.toLocaleString()}
                  icon={MessageSquare}
                />
                <MetricCard
                  title="Mensagens recebidas"
                  value={bundle.cards.messagesReceived.toLocaleString()}
                  icon={MessageSquareReply}
                />
                <MetricCard
                  title="Conversas atendidas"
                  value={bundle.cards.conversationsHandled.toLocaleString()}
                  icon={Users}
                />
                <MetricCard
                  title="Taxa de resposta"
                  value={bundle.cards.responseRatePct == null ? "—" : `${bundle.cards.responseRatePct.toFixed(0)}%`}
                  icon={Percent}
                />
                <MetricCard
                  title="Deals ganhos"
                  value={bundle.cards.dealsWon.toLocaleString()}
                  icon={Trophy}
                />
                <MetricCard
                  title="Valor vendido"
                  value={formatCurrency(bundle.cards.valueWon, defaultCurrency)}
                  icon={DollarSign}
                />
                <MetricCard
                  title="Tempo médio de resposta"
                  value={formatResponseTime(bundle.cards.avgResponseMinutes)}
                  icon={Clock}
                />
              </>
            )}
          </div>

          <MessagesPerDayChart data={bundle?.messagesPerDay ?? []} />

          <UserRankingTable
            rows={bundle?.users ?? []}
            loading={loading}
            currency={defaultCurrency}
          />
        </div>
      )}

      {tab === "pipeline" && <PipelineTab period={period} />}
      {tab === "commissions" && <CommissionsTab period={period} />}
      {tab === "broadcasts" && <BroadcastsTab period={period} />}
      {tab === "broadcastRoi" && <BroadcastRoiTab period={period} />}
      {tab === "quality" && <QualityTab />}
      {tab === "satisfaction" && <NpsTab period={period} />}
    </div>
  )
}
