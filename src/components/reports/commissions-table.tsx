"use client"

import { useLocale, useTranslations } from "next-intl"
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
import type { CommissionRow } from "@/lib/reports/types"
import { localeToIntl, type Locale } from "@/i18n/locales"

function fmtDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(localeToIntl(locale), { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function CommissionsTable({ rows, loading }: { rows: CommissionRow[]; loading: boolean }) {
  const t = useTranslations("reports.commissionsTable")
  const tCommon = useTranslations("common")
  const tDealStatus = useTranslations("reports.dealStatus")
  const locale = useLocale() as Locale

  // Totals ignore currency mixing (deliberately, like the rest of this
  // table) — summing across rows that may carry different currencies
  // would already be wrong before this change; out of scope here.
  const totals = rows.reduce(
    (acc, r) => ({
      value: acc.value + r.value * r.quantity,
      commission: acc.commission + r.commissionValue,
    }),
    { value: 0, commission: 0 },
  )
  const currency = rows[0]?.currency

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colDeal")}</TableHead>
            <TableHead>{t("colContact")}</TableHead>
            <TableHead>{t("colProduct")}</TableHead>
            <TableHead className="text-right">{t("colValue")}</TableHead>
            <TableHead className="text-right">{t("colCommission")}</TableHead>
            <TableHead>{t("colAgent")}</TableHead>
            <TableHead>{t("colStatus")}</TableHead>
            <TableHead className="text-right">{t("colDate")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                {tCommon("loading")}…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            <>
              {rows.map((row, i) => (
                <TableRow key={`${row.dealId}-${row.productName}-${i}`}>
                  <TableCell className="font-medium text-foreground">{row.dealTitle}</TableCell>
                  <TableCell>{row.contactName ?? "—"}</TableCell>
                  <TableCell>{row.productName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.value * row.quantity, row.currency)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-gold">
                    {formatCurrency(row.commissionValue, row.currency)}
                    {row.commissionRate != null && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ({row.commissionRate}%)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{row.agentName ?? "—"}</TableCell>
                  <TableCell>
                    {row.status === "open" || row.status === "won" || row.status === "lost"
                      ? tDealStatus(row.status)
                      : row.status}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmtDate(row.date, locale)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className={cn("border-t-2 border-border font-semibold")}>
                <TableCell className="text-foreground">{t("totalRow")}</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right tabular-nums">{formatCurrency(totals.value, currency)}</TableCell>
                <TableCell className="text-right tabular-nums text-gold">
                  {formatCurrency(totals.commission, currency)}
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
