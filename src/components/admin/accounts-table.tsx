import type { AdminAccountRow, SubscriptionStatus } from "@/lib/admin/types"
import { STATUS_META } from "@/lib/admin/types"
import { trialDaysRemaining } from "@/lib/admin/trial"
import { formatCurrency } from "@/lib/currency"
import { AccountActions } from "./account-actions"

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export function AccountsTable({ rows }: { rows: AdminAccountRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[#22242A] bg-[#141417] p-10 text-center text-sm text-white/40">
        Nenhuma conta encontrada para este filtro.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#22242A] bg-[#141417]">
      <table className="w-full min-w-[1280px] text-left text-sm">
        <thead>
          <tr className="border-b border-[#22242A] text-xs text-white/40">
            <th className="px-4 py-3 font-medium">Account</th>
            <th className="px-4 py-3 font-medium">Owner</th>
            <th className="px-4 py-3 font-medium">Plano</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Trial vence em</th>
            <th className="px-4 py-3 font-medium">Seats</th>
            <th className="px-4 py-3 font-medium">Valor mensal</th>
            <th className="px-4 py-3 font-medium">Último acesso</th>
            <th className="px-4 py-3 font-medium">Fim do período</th>
            <th className="px-4 py-3 font-medium">Criado em</th>
            <th className="px-4 py-3 text-right font-medium">Ações</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const sub = row.subscription
            const daysLeft = sub?.status === "trialing" ? trialDaysRemaining(sub.trial_end) : null
            const monthlyCents =
              sub && row.plan ? sub.seats * row.plan.price_per_seat_cents : null

            return (
              <tr key={row.id} className="border-b border-[#22242A] last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{row.name}</div>
                  {row.is_internal && (
                    <span className="text-[10px] font-medium tracking-wide text-[#60A5FA] uppercase">
                      Interna
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="text-white/80">{row.owner?.full_name ?? "—"}</div>
                  <div className="text-xs text-white/40">{row.owner?.email ?? "—"}</div>
                </td>
                <td className="px-4 py-3 text-white/70">{row.plan?.name ?? "—"}</td>
                <td className="px-4 py-3">
                  {sub ? (
                    <StatusBadge status={sub.status} />
                  ) : (
                    <span className="text-white/30">—</span>
                  )}
                  {sub?.cancel_at_period_end && (
                    <div className="mt-1 text-[10px] text-[#FB923C]">
                      cancela ao fim do período
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums">
                  {daysLeft === null ? (
                    <span className="text-white/30">—</span>
                  ) : (
                    <span className={daysLeft < 3 ? "font-semibold text-[#F87171]" : "text-white/70"}>
                      {daysLeft <= 0 ? "vencido" : `${daysLeft}d`}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums text-white/70">
                  {sub ? `${row.seatsUsed}/${sub.seats}` : "—"}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums text-white/70">
                  {monthlyCents !== null ? formatCurrency(monthlyCents / 100, "BRL") : "—"}
                </td>
                <td className="px-4 py-3 text-white/70">
                  {row.lastSignInAt ? fmtDate(row.lastSignInAt) : "Nunca"}
                </td>
                <td className="px-4 py-3 text-white/70">{fmtDate(sub?.current_period_end ?? null)}</td>
                <td className="px-4 py-3 text-white/70">{fmtDate(row.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <AccountActions account={row} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${meta.color}1F`, color: meta.color }}
    >
      {meta.label}
    </span>
  )
}
