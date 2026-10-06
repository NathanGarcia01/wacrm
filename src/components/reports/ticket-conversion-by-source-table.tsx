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
import type { SourceConversionRow } from "@/lib/reports/types"

const SOURCE_KEY: Record<string, "inbound" | "manualOutbound" | "campaign" | "automation"> = {
  inbound: "inbound",
  manual_outbound: "manualOutbound",
  campaign: "campaign",
  automation: "automation",
}

function fmtPct(generated: number, won: number): string {
  return generated === 0 ? "—" : `${((won / generated) * 100).toFixed(0)}%`
}

export function TicketConversionBySourceTable({
  rows,
  loading,
}: {
  rows: SourceConversionRow[]
  loading: boolean
}) {
  const t = useTranslations("reports.ticketConversionBySourceTable")
  // Same source labels already translated for the Atendimento tab's
  // "by source" chart — no reason to re-translate the same 4 words.
  const tSource = useTranslations("reports.ticketsBySourceChart")
  const tCommon = useTranslations("common")

  function labelOf(source: string | null): string {
    if (source == null) return t("noTicket")
    return SOURCE_KEY[source] ? tSource(SOURCE_KEY[source]) : source
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colSource")}</TableHead>
            <TableHead>{t("colGenerated")}</TableHead>
            <TableHead>{t("colWon")}</TableHead>
            <TableHead>{t("colConversion")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                {tCommon("loading")}…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.source ?? "none"}>
                <TableCell className="font-medium text-foreground">{labelOf(row.source)}</TableCell>
                <TableCell className="font-mono tabular-nums">{row.generated.toLocaleString()}</TableCell>
                <TableCell className="font-mono tabular-nums">{row.won.toLocaleString()}</TableCell>
                <TableCell className="font-mono tabular-nums">{fmtPct(row.generated, row.won)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
