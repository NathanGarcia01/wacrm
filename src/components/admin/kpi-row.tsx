import { Clock, DollarSign, Users } from "lucide-react"
import { formatCurrency } from "@/lib/currency"
import type { ExecutiveMetrics } from "@/lib/admin/types"
import { StatTile } from "./stat-tile"

export function KpiRow({ metrics }: { metrics: ExecutiveMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatTile
        label="ARR"
        value={formatCurrency(metrics.arrCents / 100, "BRL")}
        icon={<DollarSign className="h-4 w-4" />}
        sub={<span className="text-white/30">MRR × 12</span>}
      />
      <StatTile
        label="LTV médio estimado"
        value={metrics.ltvCents !== null ? formatCurrency(metrics.ltvCents / 100, "BRL") : "—"}
        icon={<DollarSign className="h-4 w-4" />}
        sub={
          metrics.ltvCents === null && (
            <span className="text-white/30">sem churn suficiente pra estimar</span>
          )
        }
      />
      <StatTile
        label="Contas ativas"
        value={String(metrics.activeCount)}
        icon={<Users className="h-4 w-4" />}
      />
      <StatTile
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
