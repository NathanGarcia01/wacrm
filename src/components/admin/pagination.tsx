import Link from "next/link"
import { cn } from "@/lib/utils"

export function Pagination({
  page,
  totalPages,
  status,
}: {
  page: number
  totalPages: number
  status: string | null
}) {
  if (totalPages <= 1) return null

  function hrefFor(p: number) {
    const params = new URLSearchParams()
    if (status) params.set("status", status)
    params.set("page", String(p))
    return `/admin?${params.toString()}`
  }

  return (
    <div className="flex items-center justify-between text-xs text-white/50">
      <span>
        Página <span className="font-mono text-white">{page}</span> de{" "}
        <span className="font-mono text-white">{totalPages}</span>
      </span>
      <div className="flex gap-2">
        <Link
          href={hrefFor(Math.max(1, page - 1))}
          aria-disabled={page <= 1}
          className={cn(
            "rounded-lg border border-[#22242A] px-3 py-1.5 font-medium text-white/70 hover:border-white/20 hover:text-white",
            page <= 1 && "pointer-events-none opacity-40",
          )}
        >
          Anterior
        </Link>
        <Link
          href={hrefFor(Math.min(totalPages, page + 1))}
          aria-disabled={page >= totalPages}
          className={cn(
            "rounded-lg border border-[#22242A] px-3 py-1.5 font-medium text-white/70 hover:border-white/20 hover:text-white",
            page >= totalPages && "pointer-events-none opacity-40",
          )}
        >
          Próxima
        </Link>
      </div>
    </div>
  )
}
