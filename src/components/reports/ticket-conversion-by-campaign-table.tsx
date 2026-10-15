"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown } from "lucide-react"
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
import type { CampaignConversionRow } from "@/lib/reports/types"

function fmtPct(generated: number, won: number): string {
  return generated === 0 ? "—" : `${((won / generated) * 100).toFixed(0)}%`
}

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
}

function CategoryTag({ category }: { category: string | null }) {
  if (!category) return <span className="text-muted-foreground">—</span>
  const label = CATEGORY_LABEL[category.toUpperCase()] ?? category
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
  )
}

export function TicketConversionByCampaignTable({
  rows,
  loading,
  currency,
  totalDealsWon,
}: {
  rows: CampaignConversionRow[]
  loading: boolean
  currency: string
  /** Period's total deals won (cards.dealsWon) — used only to compute
   *  "campanhas trouxeram X%", the % attributable to campaigns out of
   *  every deal won in the period, not out of campaign rows alone. */
  totalDealsWon: number
}) {
  const t = useTranslations("reports.ticketConversionByCampaignTable")
  const tCommon = useTranslations("common")
  const [expanded, setExpanded] = useState(false)

  const campaignWonTotal = rows.reduce((sum, r) => sum + r.won, 0)
  const sharePct = totalDealsWon > 0 ? Math.round((campaignWonTotal / totalDealsWon) * 100) : null

  const visibleRows = expanded ? rows : rows.slice(0, 10)
  const hasMore = rows.length > 10

  const totals = rows.reduce(
    (acc, r) => ({
      ticketsTotal: acc.ticketsTotal + r.ticketsTotal,
      generated: acc.generated + r.generated,
      won: acc.won + r.won,
      wonValue: acc.wonValue + r.wonValue,
    }),
    { ticketsTotal: 0, generated: 0, won: 0, wonValue: 0 },
  )

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
        {sharePct != null && rows.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">{t("insightShare", { pct: sharePct })}</p>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colCampaign")}</TableHead>
            <TableHead>{t("colCategory")}</TableHead>
            <TableHead className="text-right">{t("colTickets")}</TableHead>
            <TableHead className="text-right">{t("colGenerated")}</TableHead>
            <TableHead className="text-right">{t("colWon")}</TableHead>
            <TableHead className="text-right">{t("colWonValue")}</TableHead>
            <TableHead className="text-right">{t("colConversion")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                {tCommon("loading")}…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            <>
              {visibleRows.map((row) => (
                <TableRow key={row.campaignId}>
                  <TableCell className="font-medium text-foreground">{row.campaignName}</TableCell>
                  <TableCell>
                    <CategoryTag category={row.templateCategory} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.ticketsTotal.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.generated.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.won.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.wonValue, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtPct(row.generated, row.won)}
                  </TableCell>
                </TableRow>
              ))}
              {hasMore && (
                <TableRow>
                  <TableCell colSpan={7} className="py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      {expanded ? t("showLess") : t("showAll", { count: rows.length })}
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                    </button>
                  </TableCell>
                </TableRow>
              )}
              <TableRow className={cn("border-t-2 border-border font-semibold")}>
                <TableCell className="text-foreground">{t("totalRow")}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums">
                  {totals.ticketsTotal.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {totals.generated.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums">{totals.won.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.wonValue, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtPct(totals.generated, totals.won)}
                </TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
