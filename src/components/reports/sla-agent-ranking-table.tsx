"use client"

import { useTranslations } from "next-intl"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { SlaAgentRankingRow } from "@/lib/reports/types"
import { formatSlaCompliancePct, formatSlaViolations } from "@/lib/reports/format"

export function SlaAgentRankingTable({
  rows,
  loading,
  agentNames,
}: {
  rows: SlaAgentRankingRow[]
  loading: boolean
  /** userId → display name, from the same filter-options list as the
   *  user dropdown — avoids a redundant profiles join in the RPC. */
  agentNames: Map<string, string>
}) {
  const t = useTranslations("reports.slaAgentRankingTable")
  const tCommon = useTranslations("common")

  // Compliance % isn't additive across agents (it's a ratio, not a
  // count) — the Total row only sums the two violation counts, which
  // are, and leaves the % columns blank rather than show a fake
  // average.
  const totalFrViolations = rows.reduce((s, r) => s + (r.firstResponse.total - r.firstResponse.withinGoal), 0)
  const totalResViolations = rows.reduce((s, r) => s + (r.resolution.total - r.resolution.withinGoal), 0)
  const hasAnyJudged = rows.some((r) => r.firstResponse.total > 0 || r.resolution.total > 0)

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colAgent")}</TableHead>
            <TableHead className="text-right">{t("colFirstResponsePct")}</TableHead>
            <TableHead className="text-right">{t("colFirstResponseViolations")}</TableHead>
            <TableHead className="text-right">{t("colResolutionPct")}</TableHead>
            <TableHead className="text-right">{t("colResolutionViolations")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                {tCommon("loading")}…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            <>
              {rows.map((row) => (
                <TableRow key={row.userId ?? "none"}>
                  <TableCell className="font-medium text-foreground">
                    {row.userId == null ? t("noAgent") : agentNames.get(row.userId) ?? t("unknownAgent")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatSlaCompliancePct(row.firstResponse)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">
                    {formatSlaViolations(row.firstResponse)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatSlaCompliancePct(row.resolution)}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">
                    {formatSlaViolations(row.resolution)}
                  </TableCell>
                </TableRow>
              ))}
              {hasAnyJudged && (
                <TableRow className={cn("border-t-2 border-border font-semibold")}>
                  <TableCell className="text-foreground">{t("totalRow")}</TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">{totalFrViolations}</TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">{totalResViolations}</TableCell>
                </TableRow>
              )}
            </>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
