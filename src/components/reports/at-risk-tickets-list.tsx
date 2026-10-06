"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { ArrowUpRight, ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AtRiskTicketRow } from "@/lib/reports/types"

/** Same amber/red vocabulary as quality-tab.tsx's QUALITY_CLASSES —
 *  amber while there's still a (shrinking) grace window, red once the
 *  goal has actually been blown through. */
function badgeClasses(pctElapsed: number): string {
  return pctElapsed >= 100
    ? "border-destructive/30 bg-destructive/10 text-destructive"
    : "border-gold/30 bg-gold-soft text-gold"
}

export function AtRiskTicketsList({
  rows,
  loading,
  firstResponseGoalConfigured,
}: {
  rows: AtRiskTicketRow[]
  loading: boolean
  firstResponseGoalConfigured: boolean
}) {
  const t = useTranslations("reports.atRiskTicketsList")
  const tCommon = useTranslations("common")

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      </div>
      <div className="divide-y divide-border">
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{tCommon("loading")}…</p>
        ) : !firstResponseGoalConfigured ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("goalNotConfigured")}</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          rows.map((row) => (
            <Link
              key={row.ticketId}
              href={`/inbox?c=${row.conversationId}`}
              className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    #{row.protocolNumber}
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">
                    {row.contactName ?? t("unknownContact")}
                  </span>
                </div>
                {row.departmentName && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.departmentName}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
                    badgeClasses(row.pctElapsed),
                  )}
                >
                  {row.pctElapsed >= 100 ? t("breached") : `${row.pctElapsed.toFixed(0)}%`}
                </span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
