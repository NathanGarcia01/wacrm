import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import {
  getAccountById,
  getAccountMembers,
  getAccountUsageStats,
  getPlans,
  getSubscriptionEvents,
  type AccountMember,
} from "@/lib/admin/data"
import { requireAdminUser } from "@/lib/admin/require-admin"
import { AdminHeader } from "@/components/admin/admin-header"
import { StatusBadge } from "@/components/admin/accounts-table"
import { AccountActions } from "@/components/admin/account-actions"
import { ImpersonateButton } from "@/components/admin/impersonate-button"
import { AccountUsageStatsRow } from "@/components/admin/account-usage-stats"
import { AccountEventTimeline } from "@/components/admin/account-event-timeline"

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
}

interface PageProps {
  params: Promise<{ accountId: string }>
}

export default async function AccountDetailPage({ params }: PageProps) {
  const currentAdmin = await requireAdminUser()
  if (!currentAdmin) redirect("/admin/login")

  const { accountId } = await params

  const [account, events, usage, members, plans] = await Promise.all([
    getAccountById(accountId),
    getSubscriptionEvents(accountId),
    getAccountUsageStats(accountId),
    getAccountMembers(accountId),
    getPlans(),
  ])

  if (!account) notFound()

  const sub = account.subscription

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white">
      <AdminHeader admin={currentAdmin} />

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6">
        <Link
          href="/admin"
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-white/50 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para todas as contas
        </Link>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[#22242A] bg-[#141417] p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-white">{account.name}</h1>
              {account.is_internal && (
                <span className="rounded-full bg-[#60A5FA]/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-[#60A5FA] uppercase">
                  Interna
                </span>
              )}
              {sub && <StatusBadge status={sub.status} />}
            </div>
            <p className="mt-1 text-sm text-white/50">
              {account.plan?.name ?? "Sem plano"} · Criada em {fmtDate(account.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {currentAdmin.role === "owner" && <ImpersonateButton accountId={account.id} />}
            <AccountActions account={account} plans={plans} role={currentAdmin.role} />
          </div>
        </div>

        {/* Owner + members */}
        <div className="rounded-xl border border-[#22242A] bg-[#141417] p-5">
          <p className="mb-3 text-xs font-medium text-white/50">Membros</p>
          {members.length === 0 ? (
            <p className="text-sm text-white/40">Nenhum membro encontrado.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {members.map((m: AccountMember) => (
                <li
                  key={m.user_id}
                  className="flex items-center justify-between border-b border-[#22242A] py-2 text-sm last:border-0"
                >
                  <div>
                    <span className="text-white/90">{m.full_name ?? "—"}</span>
                    <span className="ml-2 text-xs text-white/40">{m.email ?? "—"}</span>
                  </div>
                  <span className="text-xs text-white/40 capitalize">{m.account_role}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Usage */}
        <div>
          <p className="mb-3 text-xs font-medium text-white/50">Uso</p>
          <AccountUsageStatsRow stats={usage} />
        </div>

        {/* Event history */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium text-white/50">Histórico de eventos</p>
            {events.total > events.rows.length && (
              <p className="text-xs text-white/30">
                Mostrando os {events.rows.length} mais recentes de {events.total}
              </p>
            )}
          </div>
          <AccountEventTimeline events={events.rows} />
        </div>
      </main>
    </div>
  )
}
