import type { ReactNode } from "react"
import Link from "next/link"
import { AlertTriangle, Clock, TrendingDown } from "lucide-react"
import type { AdminAccountRow, AdminRole, Plan } from "@/lib/admin/types"
import { trialDaysRemaining } from "@/lib/admin/trial"
import { AccountActions } from "./account-actions"

function AlertCard({
  icon,
  title,
  accounts,
  emptyText,
  accent,
  renderExtra,
}: {
  icon: ReactNode
  title: string
  accounts: AdminAccountRow[]
  emptyText: string
  accent: string
  renderExtra?: (account: AdminAccountRow) => ReactNode
}) {
  return (
    <div className="rounded-xl border border-[#22242A] bg-[#141417] p-4">
      <div className="mb-3 flex items-center gap-2">
        <span style={{ color: accent }}>{icon}</span>
        <p className="text-sm font-medium text-white">{title}</p>
        {accounts.length > 0 && (
          <span
            className="ml-auto rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: `${accent}1F`, color: accent }}
          >
            {accounts.length}
          </span>
        )}
      </div>
      {accounts.length === 0 ? (
        <p className="text-xs text-white/30">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
              <Link
                href={`/admin/accounts/${a.id}`}
                className="truncate text-white/80 hover:text-white hover:underline"
              >
                {a.name}
              </Link>
              {renderExtra?.(a)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Three risk-facing lists at the top of the panel — past-due (with a
 * direct action, reusing AccountActions' existing "portal de
 * pagamento" item rather than a bespoke second button), trials about
 * to expire, and accounts that have gone quiet. Renders nothing when
 * all three are empty — no red/yellow/orange noise on a clean day.
 */
export function AlertCards({
  pastDue,
  trialsExpiring,
  inactive,
  plans,
  role,
}: {
  pastDue: AdminAccountRow[]
  trialsExpiring: AdminAccountRow[]
  inactive: AdminAccountRow[]
  plans: Plan[]
  role: AdminRole
}) {
  const hasAny = pastDue.length > 0 || trialsExpiring.length > 0 || inactive.length > 0
  if (!hasAny) return null

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <AlertCard
        icon={<AlertTriangle className="h-4 w-4" />}
        title="🔴 Inadimplentes"
        accounts={pastDue}
        emptyText="Nenhuma conta inadimplente."
        accent="#F87171"
        renderExtra={(a) => <AccountActions account={a} plans={plans} role={role} />}
      />
      <AlertCard
        icon={<Clock className="h-4 w-4" />}
        title="🟡 Trial vencendo em breve"
        accounts={trialsExpiring}
        emptyText="Nenhum trial vencendo nos próximos 3 dias."
        accent="#FBBF24"
        renderExtra={(a) => {
          const days = trialDaysRemaining(a.subscription?.trial_end ?? null)
          return (
            <span className="shrink-0 text-white/40">
              {days !== null && days <= 0 ? "vencido" : `${days}d`}
            </span>
          )
        }}
      />
      <AlertCard
        icon={<TrendingDown className="h-4 w-4" />}
        title="🟠 Sem atividade há 7+ dias"
        accounts={inactive}
        emptyText="Nenhuma conta ativa parada."
        accent="#FB923C"
      />
    </div>
  )
}
