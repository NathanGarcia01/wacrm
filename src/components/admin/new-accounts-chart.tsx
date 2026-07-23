"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { NewAccountsPoint } from "@/lib/admin/types"

function fmtMonth(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", {
    month: "short",
    year: "2-digit",
  })
}

export function NewAccountsChart({ points }: { points: NewAccountsPoint[] }) {
  const data = points.map((p) => ({ month: fmtMonth(p.month), count: p.count }))

  return (
    <div className="rounded-xl border border-[#22242A] bg-[#141417] p-5">
      <p className="mb-4 text-xs font-medium text-white/50">Novas contas por mês</p>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#22242A" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#22242A" }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#22242A" }}
              width={32}
            />
            <Tooltip
              contentStyle={{
                background: "#0A0A0B",
                border: "1px solid #22242A",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "rgba(255,255,255,0.6)" }}
              itemStyle={{ color: "#fff" }}
            />
            <Bar dataKey="count" name="Novas contas" fill="#60A5FA" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
