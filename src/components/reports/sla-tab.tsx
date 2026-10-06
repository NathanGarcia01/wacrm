"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { AlertTriangle, Percent, ShieldAlert, Timer } from "lucide-react"

import { loadSlaDashboard } from "@/lib/reports/sla-queries"
import { loadTicketDashboardFilterOptions } from "@/lib/reports/ticket-dashboard-queries"
import {
  isTicketDashboardPeriodKey,
  resolveTicketDashboardPeriod,
  type TicketDashboardPeriodKey,
} from "@/lib/reports/ticket-dashboard-period"
import { formatSlaCompliancePct, formatSlaViolations } from "@/lib/reports/format"
import type { SlaDashboardBundle, TicketDashboardFilterOptions } from "@/lib/reports/types"

import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { AttendanceFilters } from "@/components/reports/attendance-filters"
import { SlaComplianceTrendChart } from "@/components/reports/sla-compliance-trend-chart"
import { SlaAgentRankingTable } from "@/components/reports/sla-agent-ranking-table"
import { AtRiskTicketsList } from "@/components/reports/at-risk-tickets-list"

// Own query params, same convention as attendance-tab.tsx's PARAM
// map — a different prefix (`sla*` vs `at*`) so the two tabs' state
// never collides even though both can leave params behind in the URL
// after switching away.
const PARAM = {
  period: "slaPeriod",
  from: "slaFrom",
  to: "slaTo",
  user: "slaUser",
  dept: "slaDept",
  channel: "slaChannel",
} as const

/** "Em risco agora" is a live read — re-fetch on this interval so a
 *  ticket that crosses the 80% threshold while someone's looking at
 *  the tab shows up without a manual refresh. */
const AT_RISK_REFRESH_MS = 60_000

export function SlaTab() {
  const t = useTranslations("reports.slaTab")
  const router = useRouter()
  const searchParams = useSearchParams()
  const { account } = useAuth()
  const accountId = account?.id ?? null
  const timezone = account?.timezone ?? "America/Sao_Paulo"

  const periodParam = searchParams.get(PARAM.period)
  const periodKey: TicketDashboardPeriodKey = isTicketDashboardPeriodKey(periodParam) ? periodParam : "today"
  const customFrom = searchParams.get(PARAM.from) ?? undefined
  const customTo = searchParams.get(PARAM.to) ?? undefined
  const userId = searchParams.get(PARAM.user)
  const departmentId = searchParams.get(PARAM.dept)
  const channelId = searchParams.get(PARAM.channel)

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
      .catch((err) => console.error("[reports] sla filter options failed:", err))
  }, [])
  const agentNames = useMemo(() => new Map(options.agents.map((a) => [a.userId, a.name])), [options.agents])

  const [bundle, setBundle] = useState<SlaDashboardBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false

    function load(showSkeleton: boolean) {
      if (showSkeleton) {
        setLoading(true)
      }
      setError(null)
      const db = createClient()
      loadSlaDashboard(db, { accountId: accountId as string, period, timezone, userId, departmentId, channelId })
        .then((b) => {
          if (!cancelled) setBundle(b)
        })
        .catch((err) => {
          console.error("[reports] sla dashboard load failed:", err)
          if (!cancelled) setError(t("loadFailed"))
        })
        .finally(() => {
          if (!cancelled && showSkeleton) setLoading(false)
        })
    }

    load(true)
    // "Em risco agora" is a live view of now-vs-goal — periodic
    // refetch keeps it current without a page reload. Re-fetches the
    // whole bundle (simplest — a second RPC just for at_risk isn't
    // worth the complexity) but skips the loading skeleton so the
    // rest of the tab doesn't flicker every 60s.
    const interval = setInterval(() => load(false), AT_RISK_REFRESH_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [accountId, period, timezone, userId, departmentId, channelId, t])

  const missingGoals: string[] = []
  if (bundle && bundle.firstResponseGoalMinutes == null) missingGoals.push(t("goalFirstResponse"))
  if (bundle && bundle.resolutionGoalMinutes == null) missingGoals.push(t("goalResolution"))

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
        userId={userId}
        onUserChange={(v) => setParams({ [PARAM.user]: v })}
        departmentId={departmentId}
        onDepartmentChange={(v) => setParams({ [PARAM.dept]: v })}
        channelId={channelId}
        onChannelChange={(v) => setParams({ [PARAM.channel]: v })}
        showBusinessHoursToggle={false}
        options={options}
      />

      {missingGoals.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold-soft px-4 py-3 text-sm text-gold">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("goalsNotConfigured", { goals: missingGoals.join(", ") })}{" "}
            <Link href="/settings?tab=attendance" className="font-medium underline underline-offset-2">
              {t("goalsNotConfiguredLink")}
            </Link>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !bundle ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t("firstResponsePct")}
              value={formatSlaCompliancePct(bundle.cards.firstResponse)}
              icon={Percent}
              tooltip={t("firstResponsePctTooltip")}
            />
            <MetricCard
              title={t("resolutionPct")}
              value={formatSlaCompliancePct(bundle.cards.resolution)}
              icon={Percent}
              tooltip={t("resolutionPctTooltip")}
            />
            <MetricCard
              title={t("firstResponseViolations")}
              value={formatSlaViolations(bundle.cards.firstResponse)}
              icon={Timer}
              tooltip={t("firstResponseViolationsTooltip")}
            />
            <MetricCard
              title={t("resolutionViolations")}
              value={formatSlaViolations(bundle.cards.resolution)}
              icon={ShieldAlert}
              tooltip={t("resolutionViolationsTooltip")}
            />
          </>
        )}
      </div>

      <SlaComplianceTrendChart data={bundle?.daily ?? []} granularity={bundle?.granularity ?? "day"} />

      <SlaAgentRankingTable rows={bundle?.agentRanking ?? []} loading={loading} agentNames={agentNames} />

      <AtRiskTicketsList
        rows={bundle?.atRisk ?? []}
        loading={loading}
        firstResponseGoalConfigured={bundle?.firstResponseGoalMinutes != null}
      />
    </div>
  )
}
