"use client"

import { useTranslations } from "next-intl"
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { formatCurrency } from "@/lib/currency"
import type { LossReasonPoint } from "@/lib/reports/types"

export function PipelineLossReasonChart({
  data,
  currency,
}: {
  data: LossReasonPoint[]
  currency: string
}) {
  const t = useTranslations("reports.pipelineLossReasonChart")
  const total = data.reduce((sum, d) => sum + d.count, 0)
  const points = data.map((d) => ({ ...d, label: d.label === "" ? t("noReason") : d.label }))
  const top = [...data].sort((a, b) => b.count - a.count)[0]

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm font-semibold text-foreground">{t("title")}</p>
      {total > 0 && top && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("insightTop", {
            label: top.label === "" ? t("noReason") : top.label,
            pct: Math.round((top.count / total) * 100),
          })}
        </p>
      )}
      <div className="mt-4">
      {total === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <BarChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
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
                width={40}
                fill=""
                stroke=""
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "var(--muted-foreground)" }}
                itemStyle={{ color: "var(--popover-foreground)" }}
                formatter={(value, name, item) => {
                  const point = item.payload as (typeof points)[number]
                  return [
                    `${value ?? 0} · ${formatCurrency(point.value, currency)}`,
                    t("seriesCount"),
                  ]
                }}
              />
              <Bar dataKey="count" fill="#F87171" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      </div>
    </div>
  )
}
