import type { ReactNode } from "react"
import { Clock, DollarSign, Users } from "lucide-react"
import { formatCurrency } from "@/lib/currency"
import type { ExecutiveMetrics } from "@/lib/admin/types"

function Tile({
  label,
  value,
  sub,
  icon,
}: {
  label: string
  value: string
  sub?: ReactNode
  icon: ReactNode
}) {
  return (
    <div className="rounded-xl border border-[#22242A] bg-[#141417] p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-white/50">{label}</p>
        <span className="text-white/30">{icon}</span>
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-white">{value}</p>
      {sub && <div className="mt-1 text-xs">{sub}</div>}
    </div>
  )
}

export function KpiRow({ metrics }: { metrics: ExecutiveMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Tile
        label="ARR"
        value={formatCurrency(metrics.arrCents / 100, "BRL")}
        icon={<DollarSign className="h-4 w-4" />}
        sub={<span className="text-white/30">MRR × 12</span>}
      />
      <Tile
        label="LTV médio estimado"
        value={metrics.ltvCents !== null ? formatCurrency(metrics.ltvCents / 100, "BRL") : "—"}
        icon={<DollarSign className="h-4 w-4" />}
        sub={
          metrics.ltvCents === null && (
            <span className="text-white/30">sem churn suficiente pra estimar</span>
          )
        }
      />
      <Tile
        label="Contas ativas"
        value={String(metrics.activeCount)}
        icon={<Users className="h-4 w-4" />}
      />
      <Tile
        label="Em trial"
        value={String(metrics.trialingCount)}
        icon={<Clock className="h-4 w-4" />}
        sub={
          metrics.trialsExpiringSoonCount > 0 && (
            <span className="text-[#FB923C]">
              {metrics.trialsExpiringSoonCount} vence
              {metrics.trialsExpiringSoonCount === 1 ? "" : "m"} em 7 dias
            </span>
          )
        }
      />
    </div>
  )
}
