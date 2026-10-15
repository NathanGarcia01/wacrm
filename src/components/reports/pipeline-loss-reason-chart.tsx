"use client"

import { useTranslations } from "next-intl"
import { formatCurrency } from "@/lib/currency"
import type { LossReasonPoint } from "@/lib/reports/types"

export function PipelineLossReasonChart({
  data,
  currency,
}: {
  data: LossReasonPoint[]
  currency: string
}) {
  const t = useTranslations("reports.pipelineLossReasonChart")
  const total = data.reduce((sum, d) => sum + d.count, 0)
  const top = [...data].sort((a, b) => b.count - a.count)[0]
  const rows = [...data]
    .map((d) => ({ ...d, label: d.label === "" ? t("noReason") : d.label }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm font-semibold text-foreground">{t("title")}</p>
      {total > 0 && top && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("insightTop", {
            label: top.label === "" ? t("noReason") : top.label,
            pct: Math.round((top.count / total) * 100),
          })}
        </p>
      )}
      {total === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row) => {
            const pct = total === 0 ? 0 : Math.round((row.count / total) * 100)
            return (
              <div key={row.label}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate text-foreground">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {row.count.toLocaleString()} · {formatCurrency(row.value, currency)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-destructive/80"
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
                <span className="mt-0.5 block text-right text-[11px] tabular-nums text-muted-foreground">
                  {pct}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
