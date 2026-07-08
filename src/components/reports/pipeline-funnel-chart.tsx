"use client"

import { useTranslations } from "next-intl"
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { PipelineFunnelStage } from "@/lib/reports/types"

export function PipelineFunnelChart({ stages }: { stages: PipelineFunnelStage[] }) {
  const t = useTranslations("reports.pipelineFunnelChart")

  if (stages.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground">{t("title")}</p>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      </div>
    )
  }

  const height = Math.max(160, stages.length * 44)

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-4 text-sm font-semibold text-foreground">{t("title")}</p>
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer>
          <BarChart data={stages} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
            <XAxis type="number" hide allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              className="fill-muted-foreground text-xs"
              tickLine={false}
              axisLine={false}
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
              formatter={(value) => [String(value ?? 0), t("tooltipOpenDeals")]}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={28}>
              {stages.map((s) => (
                <Cell key={s.stageId} fill={s.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
