"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
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
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/currency"
import { formatDurationSeconds, formatSlaCompliancePct } from "@/lib/reports/format"
import type { MeanMedianSeconds, UserSummaryRow } from "@/lib/reports/types"

type SortKey =
  | "name"
  | "received"
  | "closed"
  | "inProgress"
  | "tma"
  | "firstResponse"
  | "slaFirstResponse"
  | "slaResolution"
  | "messages"
  | "transfers"
  | "nps"
  | "deals"

/** One comparable value per sort key — null always sorts last
 *  regardless of direction (a missing metric isn't "the worst", it's
 *  just not there, so it shouldn't dominate either end of the list). */
function sortValue(row: UserSummaryRow, name: string, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return name
    case "received":
      return row.receivedCount
    case "closed":
      return row.closedCount
    case "inProgress":
      return row.inProgressCount
    case "tma":
      return row.tma.meanSeconds
    case "firstResponse":
      return row.firstResponse.meanSeconds
    case "slaFirstResponse":
      return row.sla.firstResponse.total === 0 ? null : row.sla.firstResponse.withinGoal / row.sla.firstResponse.total
    case "slaResolution":
      return row.sla.resolution.total === 0 ? null : row.sla.resolution.withinGoal / row.sla.resolution.total
    case "messages":
      return row.messagesSent
    case "transfers":
      return row.transfersMade
    case "nps":
      return row.npsAvgRating
    case "deals":
      return row.dealsWonValue
  }
}

function fmtMeanMedian(m: MeanMedianSeconds): string {
  if (m.meanSeconds == null) return "—"
  return `${formatDurationSeconds(m.meanSeconds)} / ${formatDurationSeconds(m.medianSeconds)}`
}

function SortableHead({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string
  sortKey: SortKey
  active: boolean
  dir: "asc" | "desc"
  onSort: (key: SortKey) => void
}) {
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </TableHead>
  )
}

export function UserSummaryTable({
  rows,
  loading,
  agentNames,
  currency,
}: {
  rows: UserSummaryRow[]
  loading: boolean
  /** userId → display name, same filter-options source as the SLA
   *  ranking table — avoids a redundant profiles join in the RPC. */
  agentNames: Map<string, string>
  currency: string
}) {
  const t = useTranslations("reports.userSummaryTable")
  const tCommon = useTranslations("common")
  const [sortKey, setSortKey] = useState<SortKey>("received")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  function nameOf(row: UserSummaryRow): string {
    return row.userId == null ? t("noAgent") : agentNames.get(row.userId) ?? t("unknownAgent")
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const sortedRows = useMemo(() => {
    const withNames = rows.map((row) => ({ row, name: nameOf(row) }))
    withNames.sort((a, b) => {
      const av = sortValue(a.row, a.name, sortKey)
      const bv = sortValue(b.row, b.name, sortKey)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number)
      return sortDir === "asc" ? cmp : -cmp
    })
    return withNames
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir])

  const columns: { key: SortKey; label: string }[] = [
    { key: "name", label: t("colAgent") },
    { key: "received", label: t("colReceived") },
    { key: "closed", label: t("colClosed") },
    { key: "inProgress", label: t("colInProgress") },
    { key: "tma", label: t("colTma") },
    { key: "firstResponse", label: t("colFirstResponse") },
    { key: "slaFirstResponse", label: t("colSlaFirstResponse") },
    { key: "slaResolution", label: t("colSlaResolution") },
    { key: "messages", label: t("colMessages") },
    { key: "transfers", label: t("colTransfers") },
    { key: "nps", label: t("colNps") },
    { key: "deals", label: t("colDeals") },
  ]

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <SortableHead
                key={col.key}
                label={col.label}
                sortKey={col.key}
                active={sortKey === col.key}
                dir={sortDir}
                onSort={handleSort}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                {tCommon("loading")}…
              </TableCell>
            </TableRow>
          ) : sortedRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            sortedRows.map(({ row, name }) => (
              <TableRow key={row.userId ?? "none"}>
                <TableCell className="font-medium text-foreground">
                  {row.userId == null ? (
                    name
                  ) : (
                    <Link
                      href={`/reports?tab=attendance&atUser=${row.userId}`}
                      className="whitespace-nowrap hover:text-primary hover:underline"
                    >
                      {name}
                    </Link>
                  )}
                </TableCell>
                <TableCell className="font-mono tabular-nums">{row.receivedCount.toLocaleString()}</TableCell>
                <TableCell className="font-mono tabular-nums">{row.closedCount.toLocaleString()}</TableCell>
                <TableCell className="font-mono tabular-nums">{row.inProgressCount.toLocaleString()}</TableCell>
                <TableCell className="whitespace-nowrap font-mono tabular-nums">{fmtMeanMedian(row.tma)}</TableCell>
                <TableCell className="whitespace-nowrap font-mono tabular-nums">
                  {fmtMeanMedian(row.firstResponse)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatSlaCompliancePct(row.sla.firstResponse)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatSlaCompliancePct(row.sla.resolution)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">{row.messagesSent.toLocaleString()}</TableCell>
                <TableCell className="whitespace-nowrap font-mono tabular-nums">
                  {row.transfersMade.toLocaleString()} / {row.transfersReceived.toLocaleString()}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {row.npsAvgRating == null ? "—" : row.npsAvgRating.toFixed(1)}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono tabular-nums">
                  {row.dealsWonCount.toLocaleString()} ({formatCurrency(row.dealsWonValue, currency)})
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
