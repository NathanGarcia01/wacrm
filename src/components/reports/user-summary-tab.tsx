"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { AlertTriangle } from "lucide-react"

import { loadUserSummaryDashboard } from "@/lib/reports/user-summary-queries"
import { loadTicketDashboardFilterOptions } from "@/lib/reports/ticket-dashboard-queries"
import {
  isTicketDashboardPeriodKey,
  resolveTicketDashboardPeriod,
  type TicketDashboardPeriodKey,
} from "@/lib/reports/ticket-dashboard-period"
import type { TicketDashboardFilterOptions, UserSummaryBundle } from "@/lib/reports/types"

import { AttendanceFilters } from "@/components/reports/attendance-filters"
import { UserSummaryTable } from "@/components/reports/user-summary-table"

// Own query params, same convention as attendance-tab.tsx/sla-tab.tsx —
// a `us*` prefix so this tab's state never collides with the other two.
const PARAM = {
  period: "usPeriod",
  from: "usFrom",
  to: "usTo",
  dept: "usDept",
  channel: "usChannel",
  bh: "usBh",
} as const

export function UserSummaryTab() {
  const t = useTranslations("reports.userSummaryTab")
  // Borrows the SLA tab's "goal not configured" copy — same banner,
  // same two goals, no reason to re-translate it a third time.
  const tSla = useTranslations("reports.slaTab")
  const router = useRouter()
  const searchParams = useSearchParams()
  const { account, defaultCurrency } = useAuth()
  const accountId = account?.id ?? null
  const timezone = account?.timezone ?? "America/Sao_Paulo"

  const periodParam = searchParams.get(PARAM.period)
  const periodKey: TicketDashboardPeriodKey = isTicketDashboardPeriodKey(periodParam) ? periodParam : "today"
  const customFrom = searchParams.get(PARAM.from) ?? undefined
  const customTo = searchParams.get(PARAM.to) ?? undefined
  const departmentId = searchParams.get(PARAM.dept)
  const channelId = searchParams.get(PARAM.channel)
  const businessHours = searchParams.get(PARAM.bh) === "1"

  const period = useMemo(
    () => resolveTicketDashboardPeriod(periodKey, timezone, customFrom, customTo),
    [periodKey, timezone, customFrom, customTo],
  )

  function setParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key)
      else params.set(key, value)
    }
    router.replace(`/reports?${params.toString()}`, { scroll: false })
  }

  function handlePeriodChange(next: { period: TicketDashboardPeriodKey; from?: string; to?: string }) {
    setParams({
      [PARAM.period]: next.period,
      [PARAM.from]: next.period === "custom" ? next.from ?? null : null,
      [PARAM.to]: next.period === "custom" ? next.to ?? null : null,
    })
  }

  const [options, setOptions] = useState<TicketDashboardFilterOptions>({ agents: [], departments: [], channels: [] })
  useEffect(() => {
    const db = createClient()
    loadTicketDashboardFilterOptions(db)
      .then(setOptions)
      .catch((err) => console.error("[reports] user summary filter options failed:", err))
  }, [])
  const agentNames = useMemo(() => new Map(options.agents.map((a) => [a.userId, a.name])), [options.agents])

  const [bundle, setBundle] = useState<UserSummaryBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    const db = createClient()
    loadUserSummaryDashboard(db, { accountId, period, departmentId, channelId, businessHours })
      .then((b) => {
        if (!cancelled) setBundle(b)
      })
      .catch((err) => {
        console.error("[reports] user summary load failed:", err)
        if (!cancelled) setError(t("loadFailed"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accountId, period, departmentId, channelId, businessHours, t])

  const missingGoals: string[] = []
  if (bundle && bundle.firstResponseGoalMinutes == null) missingGoals.push(tSla("goalFirstResponse"))
  if (bundle && bundle.resolutionGoalMinutes == null) missingGoals.push(tSla("goalResolution"))

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <AttendanceFilters
        period={period}
        onPeriodChange={handlePeriodChange}
        showUserFilter={false}
        departmentId={departmentId}
        onDepartmentChange={(v) => setParams({ [PARAM.dept]: v })}
        channelId={channelId}
        onChannelChange={(v) => setParams({ [PARAM.channel]: v })}
        businessHours={businessHours}
        onBusinessHoursChange={(v) => setParams({ [PARAM.bh]: v ? "1" : null })}
        options={options}
      />

      {missingGoals.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold-soft px-4 py-3 text-sm text-gold">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {tSla("goalsNotConfigured", { goals: missingGoals.join(", ") })}{" "}
            <Link href="/settings?tab=attendance" className="font-medium underline underline-offset-2">
              {tSla("goalsNotConfiguredLink")}
            </Link>
          </span>
        </div>
      )}

      <UserSummaryTable
        rows={bundle?.rows ?? []}
        loading={loading}
        agentNames={agentNames}
        currency={defaultCurrency}
      />
    </div>
  )
}
