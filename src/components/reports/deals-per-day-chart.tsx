"use client"

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { DealsPerDayPoint } from "@/lib/reports/types"

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

export function DealsPerDayChart({ data }: { data: DealsPerDayPoint[] }) {
  const points = data.map((d) => ({ ...d, label: fmtDate(d.date) }))

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-4 text-sm font-semibold text-foreground">Deals ganhos por dia</p>
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
              dataKey="won"
              name="Ganhos"
              stroke="#34D399"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
