"use client"

import { useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import type { Plan } from "@/lib/admin/types"

function setOrDelete(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value)
  else params.delete(key)
}

/**
 * Extra filters layered on top of the existing status `FilterPills`:
 * plan, creation date range, trial-expiring-soon toggle, and owner
 * name/email search. All state lives in the URL (matches FilterPills'
 * philosophy) so the results page stays a Server Component and
 * filters are shareable/bookmarkable.
 */
export function AccountsFilters({ plans }: { plans: Plan[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [search, setSearch] = useState(searchParams.get("search") ?? "")
  const [planId, setPlanId] = useState(searchParams.get("plan") ?? "")
  const [trialExpiring, setTrialExpiring] = useState(searchParams.get("trialExpiring") === "1")
  const [createdFrom, setCreatedFrom] = useState(searchParams.get("from") ?? "")
  const [createdTo, setCreatedTo] = useState(searchParams.get("to") ?? "")

  const hasActiveFilters = Boolean(
    searchParams.get("search") ||
      searchParams.get("plan") ||
      searchParams.get("trialExpiring") ||
      searchParams.get("from") ||
      searchParams.get("to"),
  )

  function applyFilters(e: FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams(searchParams.toString())
    params.delete("page")
    setOrDelete(params, "search", search.trim())
    setOrDelete(params, "plan", planId)
    setOrDelete(params, "trialExpiring", trialExpiring ? "1" : "")
    setOrDelete(params, "from", createdFrom)
    setOrDelete(params, "to", createdTo)
    router.push(`/admin?${params.toString()}`)
  }

  function clearFilters() {
    const params = new URLSearchParams(searchParams.toString())
    for (const key of ["search", "plan", "trialExpiring", "from", "to", "page"]) {
      params.delete(key)
    }
    setSearch("")
    setPlanId("")
    setTrialExpiring(false)
    setCreatedFrom("")
    setCreatedTo("")
    router.push(`/admin?${params.toString()}`)
  }

  return (
    <form
      onSubmit={applyFilters}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-[#22242A] bg-[#141417] p-4"
    >
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium text-white/40">Busca</label>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nome ou email do owner"
          className="h-8 w-52 rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#60A5FA]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium text-white/40">Plano</label>
        <select
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="h-8 rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2 text-sm text-white outline-none focus:border-[#60A5FA]"
        >
          <option value="">Todos</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium text-white/40">Criado de</label>
        <input
          type="date"
          value={createdFrom}
          onChange={(e) => setCreatedFrom(e.target.value)}
          className="h-8 rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2 text-sm text-white outline-none focus:border-[#60A5FA]"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium text-white/40">até</label>
        <input
          type="date"
          value={createdTo}
          onChange={(e) => setCreatedTo(e.target.value)}
          className="h-8 rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2 text-sm text-white outline-none focus:border-[#60A5FA]"
        />
      </div>

      <label className="flex h-8 items-center gap-2 text-sm text-white/70">
        <input
          type="checkbox"
          checked={trialExpiring}
          onChange={(e) => setTrialExpiring(e.target.checked)}
          className="accent-[#34D399]"
        />
        Trial vencendo em 7 dias
      </label>

      <div className="ml-auto flex items-center gap-2">
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="h-8 rounded-lg border border-[#22242A] px-3 text-xs font-medium text-white/50 hover:border-white/20 hover:text-white"
          >
            Limpar
          </button>
        )}
        <button
          type="submit"
          className="h-8 rounded-lg bg-[#34D399] px-3 text-xs font-medium text-[#0A0A0B] hover:opacity-90"
        >
          Filtrar
        </button>
      </div>
    </form>
  )
}
