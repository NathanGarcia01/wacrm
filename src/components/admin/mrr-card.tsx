import { formatCurrency } from "@/lib/currency"
import type { MrrSummary } from "@/lib/admin/types"

export function MrrCard({ mrr }: { mrr: MrrSummary }) {
  return (
    <div className="rounded-xl border border-[#22242A] bg-[#141417] p-5">
      <p className="text-xs font-medium text-white/50">MRR</p>
      <p className="mt-2 font-mono text-4xl font-semibold tabular-nums text-[#34D399]">
        {formatCurrency(mrr.totalCents / 100, "BRL")}
      </p>

      {mrr.byPlan.length === 0 ? (
        <p className="mt-4 text-xs text-white/40">Nenhuma assinatura ativa ainda.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2 border-t border-[#22242A] pt-3">
          {mrr.byPlan.map((p) => (
            <div key={p.planId} className="flex items-center justify-between text-sm">
              <span className="text-white/60">{p.planName}</span>
              <span className="font-mono tabular-nums text-white">
                {formatCurrency(p.cents / 100, "BRL")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
