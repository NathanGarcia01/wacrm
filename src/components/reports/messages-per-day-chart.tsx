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
import type { MessagesPerDayPoint } from "@/lib/reports/types"
import { localeToIntl, type Locale } from "@/i18n/locales"

function fmtDate(iso: string, locale: Locale): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(localeToIntl(locale), { day: "2-digit", month: "short" })
}

export function MessagesPerDayChart({ data }: { data: MessagesPerDayPoint[] }) {
  const t = useTranslations("reports.messagesPerDayChart")
  const locale = useLocale() as Locale
  const points = data.map((d) => ({ ...d, label: fmtDate(d.date, locale) }))

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-4 text-sm font-semibold text-foreground">{t("title")}</p>
      <div className="h-64 w-full">
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
              className="fill-muted-foreground text-xs"
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={36}
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
            />
            <Line
              type="monotone"
              dataKey="sent"
              name={t("seriesSent")}
              stroke="#60A5FA"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="received"
              name={t("seriesReceived")}
              stroke="#34D399"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-0.5 w-4 rounded-full bg-[#60A5FA]" aria-hidden />
          {t("seriesSent")}
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-0.5 w-4 rounded-full bg-[#34D399]" aria-hidden />
          {t("seriesReceived")}
        </span>
      </div>
    </div>
  )
}
