"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import { Clock, DollarSign, MessageSquare, MessageSquareReply, Percent, Trophy, Users } from "lucide-react"

import { loadReportsBundle } from "@/lib/reports/queries"
import { samePeriodLastMonth } from "@/lib/reports/period"
import { formatResponseTime } from "@/lib/reports/format"
import { gatedRelativeDelta, pointsDelta, withShortLabel, type DeltaLabels } from "@/lib/reports/delta"
import type { AccountReportCards, PeriodRange, ReportsBundle } from "@/lib/reports/types"

import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { CompactStat } from "@/components/reports/compact-stat"
import { UserRankingTable } from "@/components/reports/user-ranking-table"
import { MessagesPerDayChart } from "@/components/reports/messages-per-day-chart"

const DELTA_LABELS: DeltaLabels = {
  vsPrevious: "vs mês anterior",
  new: "Novo no período",
  flat: "Sem variação",
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}%`
}

/** Low-baseline gate (same "menos de 5" rule approved for Pipeline &
 *  Vendas): each metric is gated by whichever previous-period COUNT
 *  makes its own % unreliable at small volume — deals won for the
 *  two sales numbers, the metric's own previous value for message
 *  volume, and conversations handled (the response-rate/time sample
 *  size) for the two response metrics. */
function formatCountAbsolute(unit: string) {
  return (current: number, previous: number) => {
    const diff = current - previous
    return `${diff > 0 ? "+" : ""}${diff.toLocaleString()} ${unit}`
  }
}

function formatResponseTimeAbsolute(current: number, previous: number): string {
  const diff = current - previous
  return `${diff > 0 ? "+" : diff < 0 ? "-" : ""}${formatResponseTime(Math.abs(diff))}`
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
      loadReportsBundle(db, { ...period, ...samePeriodLastMonth(period) }),
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
  const formatCurrencyAbsolute = (current: number, previous: number) =>
    `${formatCurrency(previous, defaultCurrency)} → ${formatCurrency(current, defaultCurrency)}`
  const formatCurrencyAbsoluteShort = (current: number, previous: number) => {
    const diff = current - previous
    return `${diff > 0 ? "+" : ""}${formatCurrency(diff, defaultCurrency)}`
  }

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
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {loading || !cards ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="Valor vendido"
              value={formatCurrency(cards.valueWon, defaultCurrency)}
              icon={DollarSign}
              delta={gatedRelativeDelta(
                cards.valueWon,
                previousCards?.valueWon ?? null,
                previousCards?.dealsWon ?? 0,
                DELTA_LABELS,
                formatCurrencyAbsolute,
                true,
                formatCurrencyAbsoluteShort,
              )}
            />
            <MetricCard
              title="Negócios ganhos"
              value={cards.dealsWon.toLocaleString()}
              icon={Trophy}
              delta={gatedRelativeDelta(
                cards.dealsWon,
                previousCards?.dealsWon ?? null,
                previousCards?.dealsWon ?? 0,
                DELTA_LABELS,
                formatCountAbsolute("negócios"),
              )}
            />
            <MetricCard
              title="Mensagens enviadas"
              value={cards.messagesSent.toLocaleString()}
              icon={MessageSquare}
              delta={gatedRelativeDelta(
                cards.messagesSent,
                previousCards?.messagesSent ?? null,
                previousCards?.messagesSent ?? 0,
                DELTA_LABELS,
                formatCountAbsolute("mensagens"),
              )}
            />
            <MetricCard
              title="Taxa de resposta"
              value={fmtPct(cards.responseRatePct)}
              icon={Percent}
              delta={
                (previousCards?.conversationsHandled ?? 0) < 5
                  ? undefined
                  : withShortLabel(
                      pointsDelta(cards.responseRatePct, previousCards?.responseRatePct ?? null, DELTA_LABELS),
                      DELTA_LABELS.vsPrevious,
                    )
              }
              subtitle={(previousCards?.conversationsHandled ?? 0) < 5 ? "Sem base de comparação" : undefined}
            />
            <MetricCard
              title="Tempo médio de resposta"
              value={formatResponseTime(cards.avgResponseMinutes)}
              icon={Clock}
              delta={gatedRelativeDelta(
                cards.avgResponseMinutes,
                previousCards?.avgResponseMinutes ?? null,
                previousCards?.conversationsHandled ?? 0,
                DELTA_LABELS,
                formatResponseTimeAbsolute,
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
            <CompactStat
              icon={MessageSquareReply}
              label="Mensagens recebidas"
              value={cards.messagesReceived.toLocaleString()}
            />
            <CompactStat
              icon={Users}
              label="Conversas atendidas"
              value={cards.conversationsHandled.toLocaleString()}
            />
          </div>
        )}
      </div>

      <MessagesPerDayChart data={bundle?.messagesPerDay ?? []} />

      <UserRankingTable rows={bundle?.users ?? []} loading={loading} currency={defaultCurrency} />
    </div>
  )
}
