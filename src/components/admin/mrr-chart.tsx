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
import type { MrrSnapshotRow } from "@/lib/admin/types"
import { formatCurrency } from "@/lib/currency"

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

export function MrrChart({ snapshots }: { snapshots: MrrSnapshotRow[] }) {
  if (snapshots.length < 2) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#22242A] bg-[#141417] px-4 text-center">
        <p className="text-sm font-medium text-white/60">Ainda sem histórico suficiente</p>
        <p className="max-w-xs text-xs text-white/40">
          Snapshots diários aparecerão aqui assim que houver pelo menos 2 dias de dados
          capturados.
        </p>
      </div>
    )
  }

  const data = snapshots.map((s) => ({
    date: fmtDate(s.snapshot_date),
    mrr: s.mrr_cents / 100,
    accounts: s.total_accounts,
  }))

  return (
    <div className="rounded-xl border border-[#22242A] bg-[#141417] p-5">
      <p className="mb-4 text-xs font-medium text-white/50">Histórico de MRR</p>
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#22242A" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#22242A" }}
            />
            <YAxis
              yAxisId="mrr"
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#22242A" }}
              tickFormatter={(v: number) => formatCurrency(v, "BRL")}
              width={72}
            />
            <YAxis
              yAxisId="accounts"
              orientation="right"
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#22242A" }}
              width={40}
              allowDecimals={false}
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
              formatter={(value, name) =>
                name === "MRR"
                  ? [formatCurrency(Number(value), "BRL"), name]
                  : [value, name]
              }
            />
            <Line
              yAxisId="mrr"
              type="monotone"
              dataKey="mrr"
              name="MRR"
              stroke="#34D399"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="accounts"
              type="monotone"
              dataKey="accounts"
              name="Contas"
              stroke="#60A5FA"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-white/50">
          <span className="h-0.5 w-4 rounded-full bg-[#34D399]" aria-hidden />
          MRR
        </span>
        <span className="flex items-center gap-1.5 text-white/50">
          <span
            className="h-0 w-4 border-t-2 border-dashed border-[#60A5FA]"
            aria-hidden
          />
          Total de contas
        </span>
      </div>
    </div>
  )
}
