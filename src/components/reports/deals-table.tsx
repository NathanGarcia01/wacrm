"use client"

import { useMemo, useState } from "react"
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
import { formatCurrency } from "@/lib/currency"
import type { DealReportRow } from "@/lib/reports/types"
import { localeToIntl, type Locale } from "@/i18n/locales"

type SortKey = "title" | "contactName" | "value" | "stageName" | "assigneeName" | "createdAt" | "closedAt"

const COLUMNS: { key: SortKey; labelKey: "colTitle" | "colContact" | "colValue" | "colStage" | "colAssignee" | "colCreatedAt" | "colClosedAt" }[] = [
  { key: "title", labelKey: "colTitle" },
  { key: "contactName", labelKey: "colContact" },
  { key: "value", labelKey: "colValue" },
  { key: "stageName", labelKey: "colStage" },
  { key: "assigneeName", labelKey: "colAssignee" },
  { key: "createdAt", labelKey: "colCreatedAt" },
  { key: "closedAt", labelKey: "colClosedAt" },
]

function fmtDate(iso: string | null, locale: Locale): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString(localeToIntl(locale), { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function DealsTable({ deals, loading }: { deals: DealReportRow[]; loading: boolean }) {
  const t = useTranslations("reports.dealsTable")
  const tCommon = useTranslations("common")
  const tDealStatus = useTranslations("reports.dealStatus")
  const locale = useLocale() as Locale
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sorted = useMemo(() => {
    const copy = [...deals]
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
  }, [deals, sortKey, sortDir])

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
            <TableHead>
              <span className="text-xs font-medium text-muted-foreground">{t("colStatus")}</span>
            </TableHead>
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
            sorted.map((deal) => (
              <TableRow key={deal.id}>
                <TableCell className="font-medium text-foreground">{deal.title}</TableCell>
                <TableCell>{deal.contactName ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{formatCurrency(deal.value, deal.currency)}</TableCell>
                <TableCell>
                  {deal.stageName ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: deal.stageColor ?? undefined }}
                        aria-hidden
                      />
                      {deal.stageName}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{deal.assigneeName ?? "—"}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{fmtDate(deal.createdAt, locale)}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{fmtDate(deal.closedAt, locale)}</TableCell>
                <TableCell>
                  {deal.status === "open" || deal.status === "won" || deal.status === "lost"
                    ? tDealStatus(deal.status)
                    : deal.status}
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
