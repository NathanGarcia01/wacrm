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
import type { DealReportRow } from "@/lib/reports/types"

type SortKey = "title" | "contactName" | "value" | "stageName" | "assigneeName" | "createdAt" | "closedAt"

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "title", label: "Título" },
  { key: "contactName", label: "Contato" },
  { key: "value", label: "Valor" },
  { key: "stageName", label: "Etapa" },
  { key: "assigneeName", label: "Responsável" },
  { key: "createdAt", label: "Criado em" },
  { key: "closedAt", label: "Fechado em" },
]

const STATUS_LABEL: Record<string, string> = {
  open: "Em aberto",
  won: "Ganho",
  lost: "Perdido",
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function DealsTable({ deals, loading }: { deals: DealReportRow[]; loading: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sorted = useMemo(() => {
    const copy = [...deals]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      let diff: number
      if (typeof av === "number" && typeof bv === "number") {
        diff = av - bv
      } else {
        diff = String(av ?? "").localeCompare(String(bv ?? ""))
      }
      return sortDir === "asc" ? diff : -diff
    })
    return copy
  }, [deals, sortKey, sortDir])

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
        <h2 className="text-sm font-semibold text-foreground">Deals do período</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
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
              <span className="text-xs font-medium text-muted-foreground">Status</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                Carregando…
              </TableCell>
            </TableRow>
          ) : sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                Nenhum deal no período selecionado.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((deal) => (
              <TableRow key={deal.id}>
                <TableCell className="font-medium text-foreground">{deal.title}</TableCell>
                <TableCell>{deal.contactName ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{formatCurrency(deal.value, deal.currency)}</TableCell>
                <TableCell>
                  {deal.stageName ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: deal.stageColor ?? undefined }}
                        aria-hidden
                      />
                      {deal.stageName}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{deal.assigneeName ?? "—"}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{fmtDate(deal.createdAt)}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{fmtDate(deal.closedAt)}</TableCell>
                <TableCell>{STATUS_LABEL[deal.status] ?? deal.status}</TableCell>
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
