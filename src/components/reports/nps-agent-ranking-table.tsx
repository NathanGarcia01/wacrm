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
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colAgent")}</TableHead>
            <TableHead>{t("colAverage")}</TableHead>
            <TableHead>{t("colReviews")}</TableHead>
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
            rows.map((row) => (
              <TableRow key={row.userId}>
                <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                    <Star className="h-3.5 w-3.5 fill-gold text-gold" />
                    {row.avgRating == null ? "—" : row.avgRating.toFixed(1)}
                  </span>
                </TableCell>
                <TableCell className="font-mono tabular-nums">{row.totalResponses.toLocaleString()}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
