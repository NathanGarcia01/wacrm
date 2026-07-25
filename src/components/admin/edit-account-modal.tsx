"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Pencil } from "lucide-react"
import type { AdminAccountRow, Plan, SubscriptionStatus } from "@/lib/admin/types"
import { STATUS_META } from "@/lib/admin/types"

const STATUS_OPTIONS: SubscriptionStatus[] = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
]

function toDateInputValue(iso: string | null): string {
  if (!iso) return ""
  return iso.slice(0, 10)
}

export function EditAccountModal({ account, plans }: { account: AdminAccountRow; plans: Plan[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(account.name)
  const [ownerEmail, setOwnerEmail] = useState(account.owner?.email ?? "")
  const [planId, setPlanId] = useState(account.plan?.id ?? "")
  const [status, setStatus] = useState<SubscriptionStatus>(account.subscription?.status ?? "trialing")
  const [trialEnd, setTrialEnd] = useState(toDateInputValue(account.subscription?.trial_end ?? null))
  const [isInternal, setIsInternal] = useState(account.is_internal)
  const [isActive, setIsActive] = useState(account.is_active)
  const [seats, setSeats] = useState(account.subscription?.seats ?? 1)

  function openModal() {
    setError(null)
    setName(account.name)
    setOwnerEmail(account.owner?.email ?? "")
    setPlanId(account.plan?.id ?? "")
    setStatus(account.subscription?.status ?? "trialing")
    setTrialEnd(toDateInputValue(account.subscription?.trial_end ?? null))
    setIsInternal(account.is_internal)
    setIsActive(account.is_active)
    setSeats(account.subscription?.seats ?? 1)
    setOpen(true)
  }

  async function save() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/accounts/${account.id}/edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          ownerEmail,
          planId,
          status,
          trialEnd: trialEnd ? new Date(`${trialEnd}T00:00:00Z`).toISOString() : null,
          isInternal,
          isActive,
          seats,
        }),
      })
      const resBody = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(resBody.error ?? "Falha ao salvar")
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError("Não foi possível conectar ao servidor")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-1 rounded-lg border border-[#22242A] px-2 py-1.5 text-xs font-medium text-white/70 hover:border-white/20 hover:text-white"
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-[#22242A] bg-[#141417] p-5">
            <h2 className="text-sm font-semibold text-white">Editar conta</h2>
            <p className="mt-1 text-xs text-white/50">{account.name}</p>

            <div className="mt-4 flex flex-col gap-3">
              <Field label="Nome da conta">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 w-full rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2.5 text-sm text-white outline-none focus:border-[#60A5FA]"
                />
              </Field>

              <Field label="Email do owner">
                <input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  className="h-8 w-full rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2.5 text-sm text-white outline-none focus:border-[#60A5FA]"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Plano">
                  <select
                    value={planId}
                    onChange={(e) => setPlanId(e.target.value)}
                    className="h-8 w-full rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2 text-sm text-white outline-none focus:border-[#60A5FA]"
                  >
                    <option value="">Sem plano</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Status">
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
                    className="h-8 w-full rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2 text-sm text-white outline-none focus:border-[#60A5FA]"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Trial end">
                  <input
                    type="date"
                    value={trialEnd}
                    onChange={(e) => setTrialEnd(e.target.value)}
                    className="h-8 w-full rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2 text-sm text-white outline-none focus:border-[#60A5FA] [color-scheme:dark]"
                  />
                </Field>

                <Field label="Seats">
                  <input
                    type="number"
                    min={1}
                    value={seats}
                    onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))}
                    className="h-8 w-full rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2.5 text-sm text-white outline-none focus:border-[#60A5FA]"
                  />
                </Field>
              </div>

              <label className="flex items-center justify-between rounded-lg border border-[#22242A] px-2.5 py-2">
                <span className="text-xs text-white/70">Acesso gratuito (is_internal)</span>
                <input
                  type="checkbox"
                  checked={isInternal}
                  onChange={(e) => setIsInternal(e.target.checked)}
                  className="h-4 w-4 accent-[#34D399]"
                />
              </label>

              <label className="flex items-center justify-between rounded-lg border border-[#22242A] px-2.5 py-2">
                <span className="text-xs text-white/70">Conta ativa</span>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 accent-[#34D399]"
                />
              </label>
            </div>

            {error && (
              <div className="mt-3 rounded-lg border border-[#FB923C]/30 bg-[#FB923C]/10 px-3 py-2 text-xs text-[#FB923C]">
                {error}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-[#22242A] px-3 py-1.5 text-xs font-medium text-white/60 hover:border-white/20 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={save}
                disabled={submitting || !name.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#34D399] px-3 py-1.5 text-xs font-medium text-[#0A0A0B] disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-wide text-white/40 uppercase">{label}</span>
      {children}
    </div>
  )
}
