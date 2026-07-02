"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { BroadcastReportRow } from "@/lib/reports/types"

type SortKey = "name" | "createdAt" | "totalRecipients" | "deliveredCount" | "failedCount" | "replyRatePct"

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Nome" },
  { key: "createdAt", label: "Criada em" },
  { key: "totalRecipients", label: "Destinatários" },
  { key: "deliveredCount", label: "Entregues" },
  { key: "failedCount", label: "Falhas" },
  { key: "replyRatePct", label: "Taxa de resposta" },
]

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}%`
}

export function BroadcastsTable({ broadcasts, loading }: { broadcasts: BroadcastReportRow[]; loading: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sorted = useMemo(() => {
    const copy = [...broadcasts]
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
  }, [broadcasts, sortKey, sortDir])

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
        <h2 className="text-sm font-semibold text-foreground">Transmissões do período</h2>
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
                Nenhuma transmissão no período selecionado.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((b) => (
              <TableRow key={b.id} className="hover:bg-muted/40">
                <TableCell className="font-medium text-foreground">
                  <Link href={`/broadcasts/${b.id}`} className="hover:underline">
                    {b.name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{fmtDate(b.createdAt)}</TableCell>
                <TableCell className="tabular-nums">{b.totalRecipients.toLocaleString()}</TableCell>
                <TableCell className="tabular-nums">{b.deliveredCount.toLocaleString()}</TableCell>
                <TableCell className="tabular-nums">{b.failedCount.toLocaleString()}</TableCell>
                <TableCell className="tabular-nums">{fmtPct(b.replyRatePct)}</TableCell>
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
