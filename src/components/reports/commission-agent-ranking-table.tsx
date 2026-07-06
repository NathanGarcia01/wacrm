"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/currency"
import type { CommissionAgentRow } from "@/lib/reports/types"

export function CommissionAgentRankingTable({
  rows,
  loading,
  currency,
}: {
  rows: CommissionAgentRow[]
  loading: boolean
  currency: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Comissão por agente</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agente</TableHead>
            <TableHead>Deals ganhos</TableHead>
            <TableHead>Comissão</TableHead>
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
                Nenhuma comissão no período.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.profileId}>
                <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                <TableCell className="tabular-nums">{row.dealsWon.toLocaleString()}</TableCell>
                <TableCell className="font-medium tabular-nums text-green-500">
                  {formatCurrency(row.commissionWon, currency)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
