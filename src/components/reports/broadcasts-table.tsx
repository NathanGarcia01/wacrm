"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { BroadcastReportRow } from "@/lib/reports/types"
import { localeToIntl, type Locale } from "@/i18n/locales"

type SortKey = "name" | "createdAt" | "totalRecipients" | "deliveredCount" | "failedCount" | "replyRatePct"

const COLUMNS: { key: SortKey; labelKey: "colName" | "colCreatedAt" | "colTotalRecipients" | "colDelivered" | "colFailed" | "colReplyRate" }[] = [
  { key: "name", labelKey: "colName" },
  { key: "createdAt", labelKey: "colCreatedAt" },
  { key: "totalRecipients", labelKey: "colTotalRecipients" },
  { key: "deliveredCount", labelKey: "colDelivered" },
  { key: "failedCount", labelKey: "colFailed" },
  { key: "replyRatePct", labelKey: "colReplyRate" },
]

function fmtDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(localeToIntl(locale), { day: "2-digit", month: "2-digit", year: "numeric" })
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}%`
}

export function BroadcastsTable({ broadcasts, loading }: { broadcasts: BroadcastReportRow[]; loading: boolean }) {
  const t = useTranslations("reports.broadcastsTable")
  const tCommon = useTranslations("common")
  const locale = useLocale() as Locale
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sorted = useMemo(() => {
    const copy = [...broadcasts]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      let diff: number
      if (typeof av === "number" && typeof bv === "number") {
        diff = av - bv
      } else {
        diff = String(av ?? "").localeCompare(String(bv ?? ""))
      }
      return sortDir === "asc" ? diff : -diff
    })
    return copy
  }, [broadcasts, sortKey, sortDir])

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
            sorted.map((b) => (
              <TableRow key={b.id} className="hover:bg-muted/40">
                <TableCell className="font-medium text-foreground">
                  <Link href={`/broadcasts/${b.id}`} className="hover:underline">
                    {b.name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{fmtDate(b.createdAt, locale)}</TableCell>
                <TableCell className="tabular-nums">{b.totalRecipients.toLocaleString()}</TableCell>
                <TableCell className="tabular-nums">{b.deliveredCount.toLocaleString()}</TableCell>
                <TableCell className="tabular-nums">{b.failedCount.toLocaleString()}</TableCell>
                <TableCell className="tabular-nums">{fmtPct(b.replyRatePct)}</TableCell>
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
