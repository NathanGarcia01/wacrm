"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import { Clock, DollarSign, MessageSquare, Trophy, Users } from "lucide-react"

import { loadReportsBundle } from "@/lib/reports/queries"
import { resolvePeriod } from "@/lib/reports/period"
import { formatResponseTime } from "@/lib/reports/format"
import type { PeriodKey, ReportsBundle } from "@/lib/reports/types"

import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { PeriodFilter } from "@/components/reports/period-filter"
import { UserRankingTable } from "@/components/reports/user-ranking-table"

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

function isPeriodKey(v: string | null): v is PeriodKey {
  return v === "today" || v === "week" || v === "month" || v === "custom"
}

function ReportsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { defaultCurrency } = useAuth()

  const periodParam = searchParams.get("period")
  const periodKey: PeriodKey = isPeriodKey(periodParam) ? periodParam : "today"
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

  function updatePeriod(next: { period: PeriodKey; from?: string; to?: string }) {
    const params = new URLSearchParams()
    params.set("period", next.period)
    if (next.period === "custom" && next.from && next.to) {
      params.set("from", next.from)
      params.set("to", next.to)
    }
    router.replace(`/reports?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Relatórios</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Métricas de atendimento e vendas por período, gerais e por usuário.
        </p>
      </div>

      <PeriodFilter period={period} onChange={updatePeriod} />

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {loading || !bundle ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="Mensagens enviadas"
              value={bundle.cards.messagesSent.toLocaleString()}
              icon={MessageSquare}
            />
            <MetricCard
              title="Conversas atendidas"
              value={bundle.cards.conversationsHandled.toLocaleString()}
              icon={Users}
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

      <UserRankingTable
        rows={bundle?.users ?? []}
        loading={loading}
        currency={defaultCurrency}
      />
    </div>
  )
}
