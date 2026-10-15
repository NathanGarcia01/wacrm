"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
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
import type { UserReportRow } from "@/lib/reports/types"

type SortKey = "messagesSent" | "conversationsHandled" | "dealsWon" | "valueWon"

const COLUMNS: { key: SortKey; labelKey: "colMessagesSent" | "colConversationsHandled" | "colDealsWon" | "colValueWon" }[] = [
  { key: "messagesSent", labelKey: "colMessagesSent" },
  { key: "conversationsHandled", labelKey: "colConversationsHandled" },
  { key: "dealsWon", labelKey: "colDealsWon" },
  { key: "valueWon", labelKey: "colValueWon" },
]

export function UserRankingTable({
  rows,
  loading,
  currency,
}: {
  rows: UserReportRow[]
  loading: boolean
  currency: string
}) {
  const t = useTranslations("reports.userRankingTable")
  const tCommon = useTranslations("common")
  // Default sort: valor vendido, decrescente — matches the task spec.
  const [sortKey, setSortKey] = useState<SortKey>("valueWon")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const diff = a[sortKey] - b[sortKey]
      return sortDir === "asc" ? diff : -diff
    })
    return copy
  }, [rows, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  function displayName(row: UserReportRow): string {
    return row.profileId == null ? t("unassigned") : row.name
  }

  const top = [...rows].sort((a, b) => b.valueWon - a.valueWon)[0]
  const totals = rows.reduce(
    (acc, r) => ({
      messagesSent: acc.messagesSent + r.messagesSent,
      conversationsHandled: acc.conversationsHandled + r.conversationsHandled,
      dealsWon: acc.dealsWon + r.dealsWon,
      valueWon: acc.valueWon + r.valueWon,
    }),
    { messagesSent: 0, conversationsHandled: 0, dealsWon: 0, valueWon: 0 },
  )

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
        {top && top.valueWon > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("insightTop", { name: displayName(top), value: formatCurrency(top.valueWon, currency) })}
          </p>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colUser")}</TableHead>
            {COLUMNS.map((col) => (
              <TableHead key={col.key} className="text-right">
                <button
                  type="button"
                  onClick={() => toggleSort(col.key)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {t(col.labelKey)}
                  <SortIcon active={sortKey === col.key} dir={sortDir} />
                </button>
              </TableHead>
            ))}
            <TableHead className="text-right">
              <span
                className="text-xs font-medium text-muted-foreground"
                title={t("avgResponseTimeHeaderTooltip")}
              >
                {t("colAvgResponseTime")}
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                {tCommon("loading")}…
              </TableCell>
            </TableRow>
          ) : sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            <>
              {sorted.map((row) => (
                <TableRow key={row.profileId ?? "unassigned"}>
                  <TableCell className="font-medium text-foreground">{displayName(row)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.messagesSent.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.conversationsHandled.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.dealsWon.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.valueWon, currency)}
                  </TableCell>
                  <TableCell
                    className="text-right text-muted-foreground"
                    title={t("avgResponseTimeCellTooltip")}
                  >
                    —
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className={cn("border-t-2 border-border font-semibold")}>
                <TableCell className="text-foreground">{t("totalRow")}</TableCell>
                <TableCell className="text-right tabular-nums">{totals.messagesSent.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {totals.conversationsHandled.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums">{totals.dealsWon.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.valueWon, currency)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">—</TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />
  return dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
}
