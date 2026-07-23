"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, MoreVertical } from "lucide-react"
import type { AdminAccountRow, AdminRole, Plan } from "@/lib/admin/types"

type ActionKey =
  | "cancel_at_period_end"
  | "cancel_immediately"
  | "undo_cancel"
  | "create_portal_link"
  | "recreate"
  | "change_plan"
  | "set_internal"
  | "extend_trial"
  | "adjust_seats"
  | "send_email"

type FormKind = "change_plan" | "extend_trial" | "adjust_seats" | "send_email"

interface ActionDef {
  key: ActionKey
  label: string
  tone: "default" | "danger"
  confirmTitle: string
  confirmBody: (account: AdminAccountRow) => string
  /** Extra fields to render inside the shared confirm dialog, if any
   *  — keeps one dialog architecture instead of forking into N modals. */
  form?: FormKind
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
}

function availableActions(account: AdminAccountRow): ActionDef[] {
  const sub = account.subscription
  const actions: ActionDef[] = []

  if (sub) {
    if (sub.cancel_at_period_end) {
      actions.push({
        key: "undo_cancel",
        label: "Desfazer cancelamento",
        tone: "default",
        confirmTitle: "Desfazer cancelamento",
        confirmBody: () =>
          "A assinatura volta a renovar normalmente ao fim do período atual.",
      })
    }

    if (sub.status === "active" || sub.status === "trialing") {
      if (!sub.cancel_at_period_end) {
        actions.push({
          key: "cancel_at_period_end",
          label: "Cancelar ao fim do período",
          tone: "default",
          confirmTitle: "Cancelar ao fim do período",
          confirmBody: (a) =>
            `O acesso continua até ${fmtDate(a.subscription?.current_period_end ?? null)}. Depois disso a assinatura é cancelada automaticamente.`,
        })
      }
      actions.push({
        key: "cancel_immediately",
        label: "Cancelar imediatamente",
        tone: "danger",
        confirmTitle: "Cancelar imediatamente",
        confirmBody: () =>
          "O acesso é cortado imediatamente. Esta ação não pode ser desfeita pelo painel.",
      })
    }

    if (sub.status === "past_due" || sub.status === "unpaid") {
      actions.push({
        key: "create_portal_link",
        label: "Portal de pagamento",
        tone: "default",
        confirmTitle: "Gerar link do portal de pagamento",
        confirmBody: () =>
          "Gera um link do Stripe Customer Portal para o cliente atualizar a forma de pagamento.",
      })
      actions.push({
        key: "cancel_immediately",
        label: "Cancelar imediatamente",
        tone: "danger",
        confirmTitle: "Cancelar imediatamente",
        confirmBody: () =>
          "O acesso é cortado imediatamente. Esta ação não pode ser desfeita pelo painel.",
      })
    }

    if (sub.status === "canceled") {
      actions.push({
        key: "recreate",
        label: "Recriar assinatura",
        tone: "default",
        confirmTitle: "Recriar assinatura",
        confirmBody: () =>
          "Reativa a assinatura no Stripe se ela ainda existir por lá, ou cria uma nova assinatura para esta conta.",
      })
    }

    actions.push({
      key: "change_plan",
      label: "Mudar plano",
      tone: "default",
      confirmTitle: "Mudar plano",
      confirmBody: () => "Atualiza o plano no Stripe (com proration) e no banco.",
      form: "change_plan",
    })

    if (sub.status === "trialing") {
      actions.push({
        key: "extend_trial",
        label: "Estender trial",
        tone: "default",
        confirmTitle: "Estender trial",
        confirmBody: () =>
          "Adiciona dias ao fim do trial atual — no Stripe (se houver) e no banco.",
        form: "extend_trial",
      })
    }

    actions.push({
      key: "adjust_seats",
      label: "Ajustar seats",
      tone: "default",
      confirmTitle: "Ajustar seats",
      confirmBody: () =>
        "Muda a quantidade de seats só no banco — não altera a cobrança no Stripe.",
      form: "adjust_seats",
    })
  }

  actions.push({
    key: "set_internal",
    label: account.is_internal ? "Remover acesso gratuito" : "Dar acesso gratuito",
    tone: account.is_internal ? "danger" : "default",
    confirmTitle: account.is_internal ? "Remover acesso gratuito" : "Dar acesso gratuito",
    confirmBody: () =>
      account.is_internal
        ? "A conta volta a depender de uma assinatura ativa para usar o produto."
        : "Marca a conta como interna — ela passa a usar o produto sem depender de billing.",
  })

  actions.push({
    key: "send_email",
    label: "Enviar email ao cliente",
    tone: "default",
    confirmTitle: "Enviar email ao cliente",
    confirmBody: (a) => `Envia um email direto para ${a.owner?.email ?? "o owner desta conta"}.`,
    form: "send_email",
  })

  return actions
}

export function AccountActions({
  account,
  plans,
  role,
}: {
  account: AdminAccountRow
  plans: Plan[]
  /** Viewer sees no actions menu at all — the API rejects these
   *  mutations with 403 anyway, this is just matching UX. */
  role: AdminRole
}) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState<ActionDef | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [portalUrl, setPortalUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [planId, setPlanId] = useState(account.plan?.id ?? "")
  const [trialDays, setTrialDays] = useState(7)
  const [seats, setSeats] = useState(account.subscription?.seats ?? 1)
  const [emailSubject, setEmailSubject] = useState("")
  const [emailMessage, setEmailMessage] = useState("")

  const actions = availableActions(account)
  if (role !== "owner" || actions.length === 0) {
    return <span className="text-xs text-white/30">—</span>
  }

  function openConfirm(action: ActionDef) {
    setMenuOpen(false)
    setActive(action)
    setPortalUrl(null)
    setError(null)
    setPlanId(account.plan?.id ?? "")
    setTrialDays(7)
    setSeats(account.subscription?.seats ?? 1)
    setEmailSubject("")
    setEmailMessage("")
  }

  function closeConfirm() {
    setActive(null)
    setPortalUrl(null)
    setError(null)
  }

  async function run() {
    if (!active) return
    setSubmitting(true)
    setError(null)
    try {
      let res: Response
      if (active.key === "send_email") {
        res = await fetch(`/api/admin/accounts/${account.id}/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: emailSubject, message: emailMessage }),
        })
      } else {
        const body: Record<string, unknown> = { action: active.key }
        if (active.key === "change_plan") body.planId = planId
        if (active.key === "extend_trial") body.days = trialDays
        if (active.key === "adjust_seats") body.seats = seats
        if (active.key === "set_internal") body.value = !account.is_internal

        res = await fetch(`/api/admin/accounts/${account.id}/subscription`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      }
      const resBody = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(resBody.error ?? "Falha ao executar ação")
        return
      }
      if (active.key === "create_portal_link") {
        setPortalUrl(resBody.url as string)
        return
      }
      closeConfirm()
      router.refresh()
    } catch {
      setError("Não foi possível conectar ao servidor")
    } finally {
      setSubmitting(false)
    }
  }

  const canConfirm =
    !submitting &&
    (active?.form !== "change_plan" || Boolean(planId && planId !== account.plan?.id)) &&
    (active?.form !== "send_email" || Boolean(emailSubject.trim() && emailMessage.trim()))

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="rounded-lg border border-[#22242A] p-1.5 text-white/50 hover:border-white/20 hover:text-white"
        aria-label="Ações da conta"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {menuOpen && (
        <>
          {/* Click-outside catcher — sits below the menu, above everything else. */}
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-[#22242A] bg-[#141417] py-1 shadow-xl">
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => openConfirm(a)}
                className={`block w-full px-3 py-2 text-left text-xs font-medium hover:bg-[#22242A] ${
                  a.tone === "danger" ? "text-[#F87171]" : "text-white/80"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}

      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-[#22242A] bg-[#141417] p-5">
            <h2 className="text-sm font-semibold text-white">{active.confirmTitle}</h2>
            <p className="mt-1 text-xs text-white/50">
              {account.name} · {account.owner?.full_name ?? "—"} (
              {account.owner?.email ?? "—"})
            </p>
            <p className="mt-3 text-sm text-white/70">{active.confirmBody(account)}</p>

            {active.form === "change_plan" && (
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="mt-3 h-8 w-full rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2 text-sm text-white outline-none focus:border-[#60A5FA]"
              >
                <option value="">Selecione um plano</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === account.plan?.id ? " (atual)" : ""}
                  </option>
                ))}
              </select>
            )}

            {active.form === "extend_trial" && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={trialDays}
                  onChange={(e) => setTrialDays(Math.max(1, Number(e.target.value) || 1))}
                  className="h-8 w-20 rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2 text-sm text-white outline-none focus:border-[#60A5FA]"
                />
                <span className="text-xs text-white/50">dias a mais</span>
              </div>
            )}

            {active.form === "adjust_seats" && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={seats}
                  onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))}
                  className="h-8 w-20 rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2 text-sm text-white outline-none focus:border-[#60A5FA]"
                />
                <span className="text-xs text-white/50">seats contratados</span>
              </div>
            )}

            {active.form === "send_email" && (
              <div className="mt-3 flex flex-col gap-2">
                <input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Assunto"
                  className="h-8 rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#60A5FA]"
                />
                <textarea
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                  placeholder="Mensagem"
                  rows={4}
                  className="rounded-lg border border-[#22242A] bg-[#0A0A0B] px-2.5 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#60A5FA]"
                />
              </div>
            )}

            {error && (
              <div className="mt-3 rounded-lg border border-[#FB923C]/30 bg-[#FB923C]/10 px-3 py-2 text-xs text-[#FB923C]">
                {error}
              </div>
            )}

            {portalUrl && (
              <div className="mt-3 rounded-lg border border-[#22242A] bg-[#0A0A0B] px-3 py-2">
                <p className="mb-1 text-[10px] text-white/40">
                  Link do portal — copie e envie ao cliente
                </p>
                <input
                  readOnly
                  value={portalUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full bg-transparent font-mono text-xs text-[#60A5FA] outline-none"
                />
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeConfirm}
                className="rounded-lg border border-[#22242A] px-3 py-1.5 text-xs font-medium text-white/60 hover:border-white/20 hover:text-white"
              >
                {portalUrl ? "Fechar" : "Cancelar"}
              </button>
              {!portalUrl && (
                <button
                  type="button"
                  onClick={run}
                  disabled={!canConfirm}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                    active.tone === "danger"
                      ? "bg-[#F87171] text-[#0A0A0B]"
                      : "bg-[#34D399] text-[#0A0A0B]"
                  }`}
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirmar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
