"use client"

import { useLocale, useTranslations } from "next-intl"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { NpsTrendPoint } from "@/lib/reports/types"
import { localeToIntl, type Locale } from "@/i18n/locales"

function fmtDate(iso: string, locale: Locale): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(localeToIntl(locale), { day: "2-digit", month: "short" })
}

export function NpsTrendChart({ data }: { data: NpsTrendPoint[] }) {
  const t = useTranslations("reports.npsTrendChart")
  const locale = useLocale() as Locale
  const points = data.map((d) => ({ ...d, label: fmtDate(d.date, locale) }))
  const hasAnySample = data.some((d) => d.avgRating != null)

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-4 text-sm font-semibold text-foreground">{t("title")}</p>
      {!hasAnySample ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
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
                domain={[1, 5]}
                allowDecimals={false}
                className="fill-muted-foreground text-xs"
                tickLine={false}
                axisLine={false}
                width={24}
                fill=""
                stroke=""
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "var(--muted-foreground)" }}
                itemStyle={{ color: "var(--popover-foreground)" }}
                formatter={(value) => [value == null ? "—" : Number(value).toFixed(1), t("tooltipAverage")]}
              />
              <Line
                type="monotone"
                dataKey="avgRating"
                name={t("tooltipAverage")}
                stroke="#60A5FA"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
