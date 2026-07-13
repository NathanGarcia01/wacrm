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

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colUser")}</TableHead>
            {COLUMNS.map((col) => (
              <TableHead key={col.key}>
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
            <TableHead>
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
            sorted.map((row) => (
              <TableRow key={row.profileId}>
                <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                <TableCell className="font-mono tabular-nums">{row.messagesSent.toLocaleString()}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {row.conversationsHandled.toLocaleString()}
                </TableCell>
                <TableCell className="font-mono tabular-nums">{row.dealsWon.toLocaleString()}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatCurrency(row.valueWon, currency)}
                </TableCell>
                <TableCell
                  className="text-muted-foreground"
                  title={t("avgResponseTimeCellTooltip")}
                >
                  —
                </TableCell>
              </TableRow>
            ))
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
