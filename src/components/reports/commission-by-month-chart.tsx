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

function fmtMonth(key: string, locale: Locale): string {
  const [y, m] = key.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(localeToIntl(locale), { month: "short", year: "2-digit" })
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

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-4 text-sm font-semibold text-foreground">{t("title")}</p>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <BarChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
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
              width={48}
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
