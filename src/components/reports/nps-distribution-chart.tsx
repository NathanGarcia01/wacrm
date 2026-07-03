"use client"

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { NpsRatingDistributionPoint } from "@/lib/reports/types"

// Fixed bad→good ramp, independent of the account's chosen accent
// theme (which can be purple/orange/red — unsuitable for "5★ = good").
// Mirrors the red/amber/green vocabulary already used in quality-tab.tsx.
const RATING_COLORS: Record<number, string> = {
  1: "#ef4444",
  2: "#f97316",
  3: "#f59e0b",
  4: "#84cc16",
  5: "#22c55e",
}

export function NpsDistributionChart({ data }: { data: NpsRatingDistributionPoint[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0)
  const points = data.map((d) => ({ ...d, label: `${d.rating} ★` }))

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-4 text-sm font-semibold text-foreground">Distribuição de notas</p>
      {total === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma avaliação recebida no período.
        </p>
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
                formatter={(value) => [String(value ?? 0), "Avaliações"]}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {points.map((p) => (
                  <Cell key={p.rating} fill={RATING_COLORS[p.rating]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
