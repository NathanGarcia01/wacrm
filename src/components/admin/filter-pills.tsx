import Link from "next/link"
import { cn } from "@/lib/utils"
import { STATUS_FILTERS } from "@/lib/admin/types"

export function FilterPills({
  active,
  otherParams = {},
}: {
  active: string
  /** Non-status filters (search/plan/date range/trial toggle) to
   *  preserve when switching status pills — see accounts-filters.tsx. */
  otherParams?: Record<string, string>
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {STATUS_FILTERS.map((f) => {
        const isActive = f.key === active
        const params = new URLSearchParams(otherParams)
        if (f.key !== "all") params.set("status", f.key)
        const qs = params.toString()
        const href = qs ? `/admin?${qs}` : "/admin"
        return (
          <Link
            key={f.key}
            href={href}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "border-[#34D399]/40 bg-[#34D399]/10 text-[#34D399]"
                : "border-[#22242A] text-white/50 hover:border-white/20 hover:text-white/80",
            )}
          >
            {f.label}
          </Link>
        )
      })}
    </div>
  )
}
