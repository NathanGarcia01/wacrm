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
import { formatCurrency } from "@/lib/currency"
import type { CommissionAgentRow } from "@/lib/reports/types"

export function CommissionAgentRankingTable({
  rows,
  loading,
  currency,
}: {
  rows: CommissionAgentRow[]
  loading: boolean
  currency: string
}) {
  const t = useTranslations("reports.commissionAgentRankingTable")
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
            <TableHead>{t("colDealsWon")}</TableHead>
            <TableHead>{t("colCommission")}</TableHead>
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
              <TableRow key={row.profileId}>
                <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                <TableCell className="font-mono tabular-nums">{row.dealsWon.toLocaleString()}</TableCell>
                <TableCell className="font-mono font-medium tabular-nums text-gold">
                  {formatCurrency(row.commissionWon, currency)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
