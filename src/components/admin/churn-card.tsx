import type { ChurnSummary } from "@/lib/admin/types"

export function ChurnCard({ churn }: { churn: ChurnSummary }) {
  return (
    <div className="rounded-xl border border-[#22242A] bg-[#141417] p-5">
      <p className="text-xs font-medium text-white/50">Churn (mês atual)</p>
      <p className="mt-2 font-mono text-4xl font-semibold tabular-nums text-[#FB923C]">
        {churn.ratePercent.toFixed(1)}%
      </p>
      <p className="mt-4 border-t border-[#22242A] pt-3 text-sm text-white/60">
        <span className="font-mono tabular-nums text-white">{churn.canceledThisMonth}</span>{" "}
        cancelamento{churn.canceledThisMonth === 1 ? "" : "s"} este mês
      </p>
    </div>
  )
}
