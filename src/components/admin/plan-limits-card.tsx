import { Check, X } from "lucide-react"
import { getPlanFeatures } from "@/lib/billing/features"

interface PlanLimitsCardProps {
  /** `plans.code` for the account's subscription — null when there's
   *  no subscription/plan row. */
  planCode: string | null
  /** Internal accounts bypass billing entirely (see CLAUDE.md) — shown
   *  here as an effective Business plan, same rule getAccountPlanFeatures
   *  and usePlanFeatures apply everywhere else this is checked. */
  isInternal: boolean
}

function fmtLimit(n: number): string {
  return Number.isFinite(n) ? String(n) : "Ilimitado"
}

/** Admin-only, read-only view of what the account's plan actually
 *  unlocks — mirrors getPlanFeatures() (src/lib/billing/features.ts)
 *  so support can answer "why can't this account do X" without
 *  cross-referencing the pricing page. */
export function PlanLimitsCard({ planCode, isInternal }: PlanLimitsCardProps) {
  const features = getPlanFeatures(isInternal ? "business" : planCode)

  const flags: { label: string; on: boolean }[] = [
    { label: "Automações com IA", on: features.hasAI },
    { label: "Relatório diário automático", on: features.hasDailyReport },
    { label: "Webhook de saída", on: features.hasWebhookOut },
    { label: "API de integração", on: features.hasAPI },
  ]

  return (
    <div className="rounded-xl border border-[#22242A] bg-[#141417] p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium text-white/50">Limites do plano</p>
        {isInternal && (
          <span className="rounded-full bg-[#60A5FA]/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-[#60A5FA] uppercase">
            Interna — bypassa billing
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-[11px] text-white/40">Números WhatsApp</p>
          <p className="mt-0.5 font-mono text-sm text-white/90">{fmtLimit(features.maxChannels)}</p>
        </div>
        <div>
          <p className="text-[11px] text-white/40">Transmissões / mês</p>
          <p className="mt-0.5 font-mono text-sm text-white/90">
            {fmtLimit(features.maxBroadcastsPerMonth)}
          </p>
        </div>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-2 border-t border-[#22242A] pt-4 sm:grid-cols-4">
        {flags.map((flag) => (
          <li key={flag.label} className="flex items-center gap-1.5 text-xs">
            {flag.on ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
            ) : (
              <X className="h-3.5 w-3.5 shrink-0 text-white/25" />
            )}
            <span className={flag.on ? "text-white/80" : "text-white/40"}>{flag.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
