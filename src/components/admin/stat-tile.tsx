import type { ReactNode } from "react"

/** Shared stat-tile primitive — used by the executive KPI row and the
 *  account detail page's usage stats, so both read as one visual
 *  system instead of two near-identical hand-rolled tiles. */
export function StatTile({
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
