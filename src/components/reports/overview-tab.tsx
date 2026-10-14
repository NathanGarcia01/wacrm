"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import { Clock, DollarSign, MessageSquare, MessageSquareReply, Percent, Trophy, Users } from "lucide-react"

import { loadReportsBundle } from "@/lib/reports/queries"
import { previousPeriod } from "@/lib/reports/period"
import { formatResponseTime } from "@/lib/reports/format"
import { relativeDelta, pointsDelta, type DeltaLabels } from "@/lib/reports/delta"
import type { AccountReportCards, PeriodRange, ReportsBundle } from "@/lib/reports/types"

import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { UserRankingTable } from "@/components/reports/user-ranking-table"
import { MessagesPerDayChart } from "@/components/reports/messages-per-day-chart"

const DELTA_LABELS: DeltaLabels = {
  vsPrevious: "vs. período anterior",
  new: "Novo no período",
  flat: "Sem variação",
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}%`
}

export function OverviewTab({ period }: { period: PeriodRange }) {
  const { defaultCurrency } = useAuth()
  const [bundle, setBundle] = useState<ReportsBundle | null>(null)
  const [previousCards, setPreviousCards] = useState<AccountReportCards | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    const db = createClient()
    Promise.all([
      loadReportsBundle(db, period),
      loadReportsBundle(db, { ...period, ...previousPeriod(period) }),
    ])
      .then(([b, prev]) => {
        if (cancelled) return
        setBundle(b)
        setPreviousCards(prev.cards)
      })
      .catch((err) => {
        console.error("[reports] overview load failed:", err)
        if (!cancelled) setError("Não foi possível carregar os relatórios.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period])

  const cards = bundle?.cards ?? null

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Headline — revenue, sales, and response quality, each with a
          trend vs. the immediately preceding period of the same
          length. The other two counts (received/handled) move in
          lockstep with "Mensagens enviadas" almost always, so they
          stay in the secondary strip instead of repeating the story. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {loading || !cards ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="Valor vendido"
              value={formatCurrency(cards.valueWon, defaultCurrency)}
              icon={DollarSign}
              delta={relativeDelta(cards.valueWon, previousCards?.valueWon ?? null, DELTA_LABELS)}
            />
            <MetricCard
              title="Deals ganhos"
              value={cards.dealsWon.toLocaleString()}
              icon={Trophy}
              delta={relativeDelta(cards.dealsWon, previousCards?.dealsWon ?? null, DELTA_LABELS)}
            />
            <MetricCard
              title="Mensagens enviadas"
              value={cards.messagesSent.toLocaleString()}
              icon={MessageSquare}
              delta={relativeDelta(cards.messagesSent, previousCards?.messagesSent ?? null, DELTA_LABELS)}
            />
            <MetricCard
              title="Taxa de resposta"
              value={fmtPct(cards.responseRatePct)}
              icon={Percent}
              delta={pointsDelta(cards.responseRatePct, previousCards?.responseRatePct ?? null, DELTA_LABELS)}
            />
            <MetricCard
              title="Tempo médio de resposta"
              value={formatResponseTime(cards.avgResponseMinutes)}
              icon={Clock}
              delta={relativeDelta(
                cards.avgResponseMinutes,
                previousCards?.avgResponseMinutes ?? null,
                DELTA_LABELS,
                false,
              )}
            />
          </>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">Outros indicadores</p>
        {loading || !cards ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <MessageSquareReply className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs text-muted-foreground">Mensagens recebidas</p>
                <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
                  {cards.messagesReceived.toLocaleString()}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs text-muted-foreground">Conversas atendidas</p>
                <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
                  {cards.conversationsHandled.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <MessagesPerDayChart data={bundle?.messagesPerDay ?? []} />

      <UserRankingTable rows={bundle?.users ?? []} loading={loading} currency={defaultCurrency} />
    </div>
  )
}
