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
import { cn } from "@/lib/utils"
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

  function displayName(row: CommissionAgentRow): string {
    return row.profileId == null ? t("unassigned") : row.name
  }

  const top = [...rows].sort((a, b) => b.commissionWon - a.commissionWon)[0]
  const totals = rows.reduce(
    (acc, r) => ({ dealsWon: acc.dealsWon + r.dealsWon, commissionWon: acc.commissionWon + r.commissionWon }),
    { dealsWon: 0, commissionWon: 0 },
  )

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
        {top && top.commissionWon > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("insightTop", { name: displayName(top), value: formatCurrency(top.commissionWon, currency) })}
          </p>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colAgent")}</TableHead>
            <TableHead className="text-right">{t("colDealsWon")}</TableHead>
            <TableHead className="text-right">{t("colCommission")}</TableHead>
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
                <TableRow key={row.profileId ?? "unassigned"}>
                  <TableCell className="font-medium text-foreground">{displayName(row)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.dealsWon.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-gold">
                    {formatCurrency(row.commissionWon, currency)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className={cn("border-t-2 border-border font-semibold")}>
                <TableCell className="text-foreground">{t("totalRow")}</TableCell>
                <TableCell className="text-right tabular-nums">{totals.dealsWon.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums text-gold">
                  {formatCurrency(totals.commissionWon, currency)}
                </TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
