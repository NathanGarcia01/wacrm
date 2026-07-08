"use client"

import { useLocale, useTranslations } from "next-intl"
import { Star } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { NpsReviewRow } from "@/lib/reports/types"
import { localeToIntl, type Locale } from "@/i18n/locales"

function fmtDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(localeToIntl(locale), { day: "2-digit", month: "2-digit", year: "numeric" })
}

function Stars({ rating, awaitingLabel }: { rating: number | null; awaitingLabel: string }) {
  if (rating == null) {
    return <span className="text-xs text-muted-foreground">{awaitingLabel}</span>
  }
  return (
    <span className="inline-flex items-center gap-0.5" title={`${rating}/5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={
            i < rating
              ? "h-3.5 w-3.5 fill-amber-400 text-amber-400"
              : "h-3.5 w-3.5 text-muted-foreground/30"
          }
        />
      ))}
    </span>
  )
}

export function NpsReviewsTable({ reviews, loading }: { reviews: NpsReviewRow[]; loading: boolean }) {
  const t = useTranslations("reports.npsReviewsTable")
  const tCommon = useTranslations("common")
  const locale = useLocale() as Locale
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colContact")}</TableHead>
            <TableHead>{t("colRating")}</TableHead>
            <TableHead>{t("colComment")}</TableHead>
            <TableHead>{t("colAgent")}</TableHead>
            <TableHead>{t("colSentAt")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                {tCommon("loading")}…
              </TableCell>
            </TableRow>
          ) : reviews.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            reviews.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium text-foreground">{r.contactName ?? "—"}</TableCell>
                <TableCell>
                  <Stars rating={r.rating} awaitingLabel={t("awaitingRating")} />
                </TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground" title={r.comment ?? undefined}>
                  {r.comment ?? "—"}
                </TableCell>
                <TableCell>{r.agentName ?? "—"}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{fmtDate(r.sentAt, locale)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
