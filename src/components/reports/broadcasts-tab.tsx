"use client"

import { useEffect, useState } from "react"
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
        if (!cancelled) setError("Não foi possível carregar os dados de transmissões.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period])

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading || !bundle ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard title="Transmissões" value={bundle.cards.totalBroadcasts.toLocaleString()} icon={Radio} />
            <MetricCard title="Destinatários únicos" value={bundle.cards.uniqueRecipients.toLocaleString()} icon={Users} />
            <MetricCard title="Entregues" value={bundle.cards.delivered.toLocaleString()} icon={CheckCircle2} />
            <MetricCard title="Falhas" value={bundle.cards.failed.toLocaleString()} icon={XCircle} />
            <MetricCard title="Taxa de entrega" value={fmtPct(bundle.cards.deliveryRatePct)} icon={Percent} />
            <MetricCard title="Taxa de resposta pós-disparo" value={fmtPct(bundle.cards.replyRatePct)} icon={Reply} />
          </>
        )}
      </div>

      <BroadcastsTable broadcasts={bundle?.broadcasts ?? []} loading={loading} />
    </div>
  )
}
