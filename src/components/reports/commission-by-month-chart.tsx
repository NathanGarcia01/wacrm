"use client"

import { useLocale, useTranslations } from "next-intl"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { formatCurrency } from "@/lib/currency"
import type { CommissionByMonthPoint } from "@/lib/reports/types"
import { localeToIntl, type Locale } from "@/i18n/locales"

/** key is either "YYYY-MM" (month bucket) or "YYYY-MM-DD" (day
 *  bucket, periods <=31 days) — told apart by length. Month buckets
 *  render as "out/26" (compact slash form, not Intl's verbose "out.
 *  de 26"); day buckets as "02/out". */
function fmtMonth(key: string, locale: Locale): string {
  const parts = key.split("-").map(Number)
  const [y, m, d] = parts
  const date = new Date(y, m - 1, d ?? 1)
  const monthAbbr = date
    .toLocaleDateString(localeToIntl(locale), { month: "short" })
    .replace(/\.$/, "")
  if (d != null) return `${String(d).padStart(2, "0")}/${monthAbbr}`
  return `${monthAbbr}/${String(y).slice(-2)}`
}

export function CommissionByMonthChart({
  data,
  currency,
}: {
  data: CommissionByMonthPoint[]
  currency: string
}) {
  const t = useTranslations("reports.commissionByMonthChart")
  const locale = useLocale() as Locale
  const points = data.map((d) => ({ ...d, label: fmtMonth(d.month, locale) }))
  const peak = [...points].sort((a, b) => b.commission - a.commission)[0]

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm font-semibold text-foreground">{t("title")}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {peak && peak.commission > 0
          ? t("insightPeak", { month: peak.label, value: formatCurrency(peak.commission, currency) })
          : t("insightNone")}
      </p>
      <div className="mt-4 h-64 w-full">
        <ResponsiveContainer>
          <BarChart data={points} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid className="stroke-border" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              className="fill-muted-foreground text-xs"
              tickLine={false}
              axisLine={false}
              fill=""
              stroke=""
            />
            <YAxis
              className="fill-muted-foreground text-xs"
              tickLine={false}
              axisLine={false}
              width={64}
              domain={[0, (max: number) => Math.ceil((max || 1) * 1.15)]}
              tickFormatter={(v) => formatCurrency(v, currency)}
              fill=""
              stroke=""
            />
            <Tooltip
              formatter={(value) => formatCurrency(Number(value), currency)}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--muted-foreground)" }}
              itemStyle={{ color: "var(--popover-foreground)" }}
            />
            <Bar dataKey="commission" name={t("seriesCommission")} fill="#34D399" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
