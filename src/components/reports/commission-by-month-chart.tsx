"use client"

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

function fmtMonth(key: string): string {
  const [y, m] = key.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
}

export function CommissionByMonthChart({
  data,
  currency,
}: {
  data: CommissionByMonthPoint[]
  currency: string
}) {
  const points = data.map((d) => ({ ...d, label: fmtMonth(d.month) }))

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-4 text-sm font-semibold text-foreground">Comissão por mês</p>
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
            <Bar dataKey="commission" name="Comissão" fill="#34D399" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
