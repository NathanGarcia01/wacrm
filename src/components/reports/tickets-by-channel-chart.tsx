"use client"

import { useTranslations } from "next-intl"
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { TicketsByChannelPoint } from "@/lib/reports/types"

export function TicketsByChannelChart({ data }: { data: TicketsByChannelPoint[] }) {
  const t = useTranslations("reports.ticketsByChannelChart")
  const total = data.reduce((sum, d) => sum + d.count, 0)
  const points = data.map((d) => ({ ...d, label: d.channelName ?? t("noChannel") }))

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-4 text-sm font-semibold text-foreground">{t("title")}</p>
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
                width={28}
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
                formatter={(value) => [String(value ?? 0), t("seriesCount")]}
              />
              <Bar dataKey="count" fill="#60A5FA" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
