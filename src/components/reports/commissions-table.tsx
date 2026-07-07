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
import type { CommissionRow } from "@/lib/reports/types"

const STATUS_LABEL: Record<string, string> = {
  open: "Em aberto",
  won: "Ganho",
  lost: "Perdido",
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function CommissionsTable({ rows, loading }: { rows: CommissionRow[]; loading: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Comissões</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Deal</TableHead>
            <TableHead>Contato</TableHead>
            <TableHead>Produto</TableHead>
            <TableHead>Valor</TableHead>
            <TableHead>Comissão</TableHead>
            <TableHead>Agente</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Data</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                Carregando…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma comissão encontrada para os filtros selecionados.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, i) => (
              <TableRow key={`${row.dealId}-${row.productName}-${i}`}>
                <TableCell className="font-medium text-foreground">{row.dealTitle}</TableCell>
                <TableCell>{row.contactName ?? "—"}</TableCell>
                <TableCell>{row.productName}</TableCell>
                <TableCell className="tabular-nums">
                  {formatCurrency(row.value * row.quantity, row.currency)}
                </TableCell>
                <TableCell className="tabular-nums font-medium text-green-500">
                  {formatCurrency(row.commissionValue, row.currency)}
                  {row.commissionRate != null && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({row.commissionRate}%)
                    </span>
                  )}
                </TableCell>
                <TableCell>{row.agentName ?? "—"}</TableCell>
                <TableCell>{STATUS_LABEL[row.status] ?? row.status}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{fmtDate(row.date)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
