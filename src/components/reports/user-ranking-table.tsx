"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/currency"
import type { UserReportRow } from "@/lib/reports/types"

type SortKey = "messagesSent" | "conversationsHandled" | "dealsWon" | "valueWon"

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "messagesSent", label: "Mensagens enviadas" },
  { key: "conversationsHandled", label: "Conversas atendidas" },
  { key: "dealsWon", label: "Deals ganhos" },
  { key: "valueWon", label: "Valor vendido" },
]

export function UserRankingTable({
  rows,
  loading,
  currency,
}: {
  rows: UserReportRow[]
  loading: boolean
  currency: string
}) {
  // Default sort: valor vendido, decrescente — matches the task spec.
  const [sortKey, setSortKey] = useState<SortKey>("valueWon")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const diff = a[sortKey] - b[sortKey]
      return sortDir === "asc" ? diff : -diff
    })
    return copy
  }, [rows, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Ranking por usuário</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Usuário</TableHead>
            {COLUMNS.map((col) => (
              <TableHead key={col.key}>
                <button
                  type="button"
                  onClick={() => toggleSort(col.key)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {col.label}
                  <SortIcon active={sortKey === col.key} dir={sortDir} />
                </button>
              </TableHead>
            ))}
            <TableHead>
              <span
                className="text-xs font-medium text-muted-foreground"
                title="Sender_id não é confiável por agente ainda — será calculado individualmente quando esse dado estiver disponível."
              >
                Tempo médio de resposta
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                Carregando…
              </TableCell>
            </TableRow>
          ) : sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                Nenhum membro encontrado.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((row) => (
              <TableRow key={row.profileId}>
                <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                <TableCell className="tabular-nums">{row.messagesSent.toLocaleString()}</TableCell>
                <TableCell className="tabular-nums">
                  {row.conversationsHandled.toLocaleString()}
                </TableCell>
                <TableCell className="tabular-nums">{row.dealsWon.toLocaleString()}</TableCell>
                <TableCell className="tabular-nums">
                  {formatCurrency(row.valueWon, currency)}
                </TableCell>
                <TableCell
                  className="text-muted-foreground"
                  title="Será calculado individualmente quando os dados estiverem disponíveis."
                >
                  —
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />
  return dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
}
