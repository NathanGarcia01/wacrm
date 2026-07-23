"use client"

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import type { MrrByPlanEntry } from "@/lib/admin/types"
import { formatCurrency } from "@/lib/currency"

// Fixed order, never re-derived per render — matches the app-wide
// accent set already used by mrr-chart.tsx / distribution-bar.tsx.
// `PlanCode` is a closed 3-value enum so a 4th color exists only as
// a safety margin, not an expected case.
const COLORS = ["#34D399", "#60A5FA", "#FB923C", "#F87171"]

export function MrrPlanPie({ byPlan }: { byPlan: MrrByPlanEntry[] }) {
  if (byPlan.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-[#22242A] bg-[#141417] text-sm text-white/40">
        Nenhuma assinatura ativa ainda.
      </div>
    )
  }

  const data = byPlan.map((p) => ({ name: p.planName, value: p.cents / 100 }))

  return (
    <div className="rounded-xl border border-[#22242A] bg-[#141417] p-5">
      <p className="mb-4 text-xs font-medium text-white/50">MRR por plano</p>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={50}
              outerRadius={90}
              paddingAngle={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="#141417" />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "#0A0A0B",
                border: "1px solid #22242A",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "rgba(255,255,255,0.6)" }}
              itemStyle={{ color: "#fff" }}
              formatter={(value) => formatCurrency(Number(value), "BRL")}
            />
            <Legend
              formatter={(value: string) => (
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
