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
import type { SlaDailyPoint } from "@/lib/reports/types"
import { localeToIntl, type Locale } from "@/i18n/locales"

function fmtDate(key: string, locale: Locale, granularity: "hour" | "day"): string {
  if (granularity === "hour") return key.slice(11, 13) + "h"
  return new Date(`${key}T00:00:00`).toLocaleDateString(localeToIntl(locale), { day: "2-digit", month: "short" })
}

/** null when nothing was judged yet that bucket — a gap in the line
 *  (via `connectNulls`), never a misleading 0%. */
function pct(total: number, within: number): number | null {
  return total === 0 ? null : (within / total) * 100
}

export function SlaComplianceTrendChart({
  data,
  granularity,
}: {
  data: SlaDailyPoint[]
  granularity: "hour" | "day"
}) {
  const t = useTranslations("reports.slaComplianceTrendChart")
  const locale = useLocale() as Locale
  const points = data.map((d) => ({
    label: fmtDate(d.date, locale, granularity),
    firstResponsePct: pct(d.firstResponse.total, d.firstResponse.withinGoal),
    resolutionPct: pct(d.resolution.total, d.resolution.withinGoal),
  }))
  const hasAnySample = points.some((p) => p.firstResponsePct != null || p.resolutionPct != null)

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-4 text-sm font-semibold text-foreground">{t("title")}</p>
      {!hasAnySample ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
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
                  domain={[0, 100]}
                  allowDecimals={false}
                  className="fill-muted-foreground text-xs"
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tickFormatter={(v) => `${v}%`}
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
                  formatter={(value, name) => [
                    value == null ? "—" : `${Number(value).toFixed(0)}%`,
                    name === "firstResponsePct" ? t("seriesFirstResponse") : t("seriesResolution"),
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="firstResponsePct"
                  name="firstResponsePct"
                  stroke="#60A5FA"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="resolutionPct"
                  name="resolutionPct"
                  stroke="#34D399"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-0.5 w-4 rounded-full bg-[#60A5FA]" aria-hidden />
              {t("seriesFirstResponse")}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-0.5 w-4 rounded-full bg-[#34D399]" aria-hidden />
              {t("seriesResolution")}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
