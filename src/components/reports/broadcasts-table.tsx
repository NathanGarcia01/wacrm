"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import type { BroadcastReportRow } from "@/lib/reports/types"
import { localeToIntl, type Locale } from "@/i18n/locales"

type SortKey =
  | "name"
  | "createdAt"
  | "sentCount"
  | "repliedCount"
  | "button1"
  | "button2"
  | "dealsWon"
  | "commissionGenerated"

const COLUMNS: {
  key: SortKey
  labelKey:
    | "colName"
    | "colCreatedAt"
    | "colSent"
    | "colReplied"
    | "colButton1"
    | "colButton2"
    | "colDealsWon"
    | "colCommission"
  align?: "right"
}[] = [
  { key: "name", labelKey: "colName" },
  { key: "createdAt", labelKey: "colCreatedAt" },
  { key: "sentCount", labelKey: "colSent", align: "right" },
  { key: "repliedCount", labelKey: "colReplied", align: "right" },
  { key: "button1", labelKey: "colButton1", align: "right" },
  { key: "button2", labelKey: "colButton2", align: "right" },
  { key: "dealsWon", labelKey: "colDealsWon", align: "right" },
  { key: "commissionGenerated", labelKey: "colCommission", align: "right" },
]

function fmtDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(localeToIntl(locale), { day: "2-digit", month: "2-digit", year: "numeric" })
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}%`
}

function sortValue(row: BroadcastReportRow, key: SortKey): number | string {
  switch (key) {
    case "button1":
      return row.button1?.count ?? 0
    case "button2":
      return row.button2?.count ?? 0
    default:
      return row[key]
  }
}

export function BroadcastsTable({ broadcasts, loading }: { broadcasts: BroadcastReportRow[]; loading: boolean }) {
  const t = useTranslations("reports.broadcastsTable")
  const tCommon = useTranslations("common")
  const locale = useLocale() as Locale
  const { defaultCurrency } = useAuth()
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sorted = useMemo(() => {
    const copy = [...broadcasts]
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey)
      const bv = sortValue(b, sortKey)
      const diff =
        typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv))
      return sortDir === "asc" ? diff : -diff
    })
    return copy
  }, [broadcasts, sortKey, sortDir])

  const totals = useMemo(
    () =>
      broadcasts.reduce(
        (acc, b) => ({
          sentCount: acc.sentCount + b.sentCount,
          repliedCount: acc.repliedCount + b.repliedCount,
          button1Count: acc.button1Count + (b.button1?.count ?? 0),
          button2Count: acc.button2Count + (b.button2?.count ?? 0),
          dealsWon: acc.dealsWon + b.dealsWon,
          commissionGenerated: acc.commissionGenerated + b.commissionGenerated,
        }),
        { sentCount: 0, repliedCount: 0, button1Count: 0, button2Count: 0, dealsWon: 0, commissionGenerated: 0 },
      ),
    [broadcasts],
  )

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
            {COLUMNS.map((col) => (
              <TableHead key={col.key} className={col.align === "right" ? "text-right" : undefined}>
                <button
                  type="button"
                  onClick={() => toggleSort(col.key)}
                  className={`inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground ${
                    col.align === "right" ? "flex-row-reverse" : ""
                  }`}
                >
                  {t(col.labelKey)}
                  <SortIcon active={sortKey === col.key} dir={sortDir} />
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                {tCommon("loading")}…
              </TableCell>
            </TableRow>
          ) : sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((b) => (
              <TableRow key={b.id} className="hover:bg-muted/40">
                <TableCell className="font-medium text-foreground">
                  <Link href={`/broadcasts/${b.id}`} className="hover:underline">
                    {b.name}
                  </Link>
                  <p className="text-xs font-normal text-muted-foreground">{b.templateName}</p>
                </TableCell>
                <TableCell className="font-mono tabular-nums text-muted-foreground">
                  {fmtDate(b.createdAt, locale)}
                </TableCell>
                <TableCell className="font-mono tabular-nums text-right">{b.sentCount.toLocaleString()}</TableCell>
                <TableCell className="font-mono tabular-nums text-right">
                  {b.repliedCount.toLocaleString()}
                  <span className="ml-1 text-muted-foreground">({fmtPct(b.replyRatePct)})</span>
                </TableCell>
                <TableCell className="text-right">
                  {b.button1 ? (
                    <span className="font-mono tabular-nums">
                      <span className="text-foreground">{b.button1.label}</span>{" "}
                      {b.button1.count.toLocaleString()}
                      <span className="ml-1 text-muted-foreground">({fmtPct(b.button1.pct)})</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {b.button2 ? (
                    <span className="font-mono tabular-nums">
                      <span className="text-foreground">{b.button2.label}</span>{" "}
                      {b.button2.count.toLocaleString()}
                      <span className="ml-1 text-muted-foreground">({fmtPct(b.button2.pct)})</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="font-mono tabular-nums text-right">{b.dealsWon.toLocaleString()}</TableCell>
                <TableCell className="font-mono tabular-nums text-right text-gold">
                  {formatCurrency(b.commissionGenerated, defaultCurrency)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        {!loading && sorted.length > 0 && (
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="font-semibold text-foreground">{t("total")}</TableCell>
              <TableCell />
              <TableCell className="font-mono tabular-nums text-right font-semibold">
                {totals.sentCount.toLocaleString()}
              </TableCell>
              <TableCell className="font-mono tabular-nums text-right font-semibold">
                {totals.repliedCount.toLocaleString()}
              </TableCell>
              <TableCell className="font-mono tabular-nums text-right font-semibold">
                {totals.button1Count.toLocaleString()}
              </TableCell>
              <TableCell className="font-mono tabular-nums text-right font-semibold">
                {totals.button2Count.toLocaleString()}
              </TableCell>
              <TableCell className="font-mono tabular-nums text-right font-semibold">
                {totals.dealsWon.toLocaleString()}
              </TableCell>
              <TableCell className="font-mono tabular-nums text-right font-semibold text-gold">
                {formatCurrency(totals.commissionGenerated, defaultCurrency)}
              </TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />
  return dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
}
