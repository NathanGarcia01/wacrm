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
import type { CampaignConversionRow } from "@/lib/reports/types"

function fmtPct(generated: number, won: number): string {
  return generated === 0 ? "—" : `${((won / generated) * 100).toFixed(0)}%`
}

export function TicketConversionByCampaignTable({
  rows,
  loading,
}: {
  rows: CampaignConversionRow[]
  loading: boolean
}) {
  const t = useTranslations("reports.ticketConversionByCampaignTable")
  const tCommon = useTranslations("common")

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colCampaign")}</TableHead>
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
              <TableRow key={row.campaignId}>
                <TableCell className="font-medium text-foreground">{row.campaignName}</TableCell>
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
