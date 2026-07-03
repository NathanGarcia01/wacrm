"use client"

import { Star } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { NpsAgentRankingRow } from "@/lib/reports/types"

export function NpsAgentRankingTable({
  rows,
  loading,
}: {
  rows: NpsAgentRankingRow[]
  loading: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Ranking de agentes por avaliação</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agente</TableHead>
            <TableHead>Média</TableHead>
            <TableHead>Avaliações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                Carregando…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma avaliação atribuída a um agente no período.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.userId}>
                <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {row.avgRating == null ? "—" : row.avgRating.toFixed(1)}
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">{row.totalResponses.toLocaleString()}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
