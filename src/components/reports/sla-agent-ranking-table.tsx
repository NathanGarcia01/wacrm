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
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colAgent")}</TableHead>
            <TableHead>{t("colFirstResponsePct")}</TableHead>
            <TableHead>{t("colFirstResponseViolations")}</TableHead>
            <TableHead>{t("colResolutionPct")}</TableHead>
            <TableHead>{t("colResolutionViolations")}</TableHead>
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
            rows.map((row) => (
              <TableRow key={row.userId ?? "none"}>
                <TableCell className="font-medium text-foreground">
                  {row.userId == null ? t("noAgent") : agentNames.get(row.userId) ?? t("unknownAgent")}
                </TableCell>
                <TableCell className="font-mono tabular-nums">{formatSlaCompliancePct(row.firstResponse)}</TableCell>
                <TableCell className="font-mono tabular-nums text-destructive">
                  {formatSlaViolations(row.firstResponse)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">{formatSlaCompliancePct(row.resolution)}</TableCell>
                <TableCell className="font-mono tabular-nums text-destructive">
                  {formatSlaViolations(row.resolution)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
