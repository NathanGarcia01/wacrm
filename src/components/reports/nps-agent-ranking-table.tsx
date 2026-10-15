"use client"

import { useTranslations } from "next-intl"
import { Star } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { NpsAgentRankingRow } from "@/lib/reports/types"

export function NpsAgentRankingTable({
  rows,
  loading,
}: {
  rows: NpsAgentRankingRow[]
  loading: boolean
}) {
  const t = useTranslations("reports.npsAgentRankingTable")
  const tCommon = useTranslations("common")

  function displayName(row: NpsAgentRankingRow): string {
    return row.userId == null ? t("unassigned") : row.name
  }

  const top = [...rows].sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0))[0]
  const totalResponses = rows.reduce((s, r) => s + r.totalResponses, 0)
  const totalAvg =
    totalResponses === 0
      ? null
      : rows.reduce((s, r) => s + (r.avgRating ?? 0) * r.totalResponses, 0) / totalResponses

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
        {top && top.avgRating != null && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("insightTop", { name: displayName(top), value: top.avgRating.toFixed(1) })}
          </p>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colAgent")}</TableHead>
            <TableHead className="text-right">{t("colAverage")}</TableHead>
            <TableHead className="text-right">{t("colReviews")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                {tCommon("loading")}…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            <>
              {rows.map((row) => (
                <TableRow key={row.userId ?? "unassigned"}>
                  <TableCell className="font-medium text-foreground">{displayName(row)}</TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center justify-end gap-1 tabular-nums">
                      <Star className="h-3.5 w-3.5 fill-gold text-gold" />
                      {row.avgRating == null ? "—" : row.avgRating.toFixed(1)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.totalResponses.toLocaleString()}</TableCell>
                </TableRow>
              ))}
              <TableRow className={cn("border-t-2 border-border font-semibold")}>
                <TableCell className="text-foreground">{t("totalRow")}</TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center justify-end gap-1 tabular-nums">
                    <Star className="h-3.5 w-3.5 fill-gold text-gold" />
                    {totalAvg == null ? "—" : totalAvg.toFixed(1)}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{totalResponses.toLocaleString()}</TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
