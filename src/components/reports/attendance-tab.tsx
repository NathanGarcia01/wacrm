"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  Inbox,
  Reply,
  Timer,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react"

import { loadTicketDashboard, loadTicketDashboardFilterOptions } from "@/lib/reports/ticket-dashboard-queries"
import { resolveTicketDashboardPeriod, type TicketDashboardPeriodKey } from "@/lib/reports/ticket-dashboard-period"
import { formatDurationSeconds } from "@/lib/reports/format"
import type { TicketDashboardBundle, TicketDashboardFilterOptions } from "@/lib/reports/types"

import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { AttendanceFilters } from "@/components/reports/attendance-filters"
import { TicketsPerDayChart } from "@/components/reports/tickets-per-day-chart"
import { TicketsByChannelChart } from "@/components/reports/tickets-by-channel-chart"
import { TicketsBySourceChart } from "@/components/reports/tickets-by-source-chart"
import { TicketsByDepartmentChart } from "@/components/reports/tickets-by-department-chart"
import { TicketsByClosingReasonChart } from "@/components/reports/tickets-by-closing-reason-chart"

export function AttendanceTab() {
  const t = useTranslations("reports.attendanceTab")
  const { account } = useAuth()
  const accountId = account?.id ?? null
  const timezone = account?.timezone ?? "America/Sao_Paulo"

  const [periodKey, setPeriodKey] = useState<TicketDashboardPeriodKey>("today")
  const [customFrom, setCustomFrom] = useState<string | undefined>(undefined)
  const [customTo, setCustomTo] = useState<string | undefined>(undefined)
  const [userId, setUserId] = useState<string | null>(null)
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const [channelId, setChannelId] = useState<string | null>(null)
  const [businessHours, setBusinessHours] = useState(false)

  const period = useMemo(
    () => resolveTicketDashboardPeriod(periodKey, timezone, customFrom, customTo),
    [periodKey, timezone, customFrom, customTo],
  )

  const [options, setOptions] = useState<TicketDashboardFilterOptions>({ agents: [], departments: [], channels: [] })
  useEffect(() => {
    const db = createClient()
    loadTicketDashboardFilterOptions(db)
      .then(setOptions)
      .catch((err) => console.error("[reports] attendance filter options failed:", err))
  }, [])

  const [bundle, setBundle] = useState<TicketDashboardBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    const db = createClient()
    loadTicketDashboard(db, { accountId, period, userId, departmentId, channelId, businessHours })
      .then((b) => {
        if (!cancelled) setBundle(b)
      })
      .catch((err) => {
        console.error("[reports] attendance dashboard load failed:", err)
        if (!cancelled) setError(t("loadFailed"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accountId, period, userId, departmentId, channelId, businessHours, t])

  function handlePeriodChange(next: { period: TicketDashboardPeriodKey; from?: string; to?: string }) {
    setPeriodKey(next.period)
    if (next.period === "custom") {
      setCustomFrom(next.from)
      setCustomTo(next.to)
    }
  }

  const showBusinessHoursWarning = businessHours && bundle != null && !bundle.businessHoursConfigured

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
        onUserChange={setUserId}
        departmentId={departmentId}
        onDepartmentChange={setDepartmentId}
        channelId={channelId}
        onChannelChange={setChannelId}
        businessHours={businessHours}
        onBusinessHoursChange={setBusinessHours}
        options={options}
      />

      {showBusinessHoursWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold-soft px-4 py-3 text-sm text-gold">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("businessHoursNotConfigured")}{" "}
            <Link href="/settings?tab=attendance" className="font-medium underline underline-offset-2">
              {t("businessHoursNotConfiguredLink")}
            </Link>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {loading || !bundle ? (
          Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t("totalTickets")}
              value={bundle.cards.totalTickets.toLocaleString()}
              icon={Inbox}
              tooltip={t("totalTicketsTooltip")}
            />
            <MetricCard
              title={t("initiatedByCustomer")}
              value={bundle.cards.initiatedByCustomer.toLocaleString()}
              icon={ArrowDownToLine}
              tooltip={t("initiatedByCustomerTooltip")}
            />
            <MetricCard
              title={t("initiatedByCompany")}
              value={bundle.cards.initiatedByCompany.toLocaleString()}
              icon={ArrowUpFromLine}
              tooltip={t("initiatedByCompanyTooltip")}
            />
            <MetricCard
              title={t("pending")}
              value={bundle.cards.pending.toLocaleString()}
              icon={Clock}
              tooltip={t("pendingTooltip")}
            />
            <MetricCard
              title={t("inProgress")}
              value={bundle.cards.inProgress.toLocaleString()}
              icon={Activity}
              tooltip={t("inProgressTooltip")}
            />
            <MetricCard
              title={t("agentsCount")}
              value={bundle.cards.agentsCount.toLocaleString()}
              icon={Users}
              tooltip={t("agentsCountTooltip")}
            />
            <MetricCard
              title={t("contactsServed")}
              value={bundle.cards.contactsServed.toLocaleString()}
              icon={UserCheck}
              tooltip={t("contactsServedTooltip")}
            />
            <MetricCard
              title={t("newContacts")}
              value={bundle.cards.newContacts.toLocaleString()}
              icon={UserPlus}
              tooltip={t("newContactsTooltip")}
            />
            <MetricCard
              title={t("tma")}
              value={formatDurationSeconds(bundle.cards.tmaSeconds)}
              icon={Timer}
              tooltip={t("tmaTooltip")}
            />
            <MetricCard
              title={t("firstResponse")}
              value={formatDurationSeconds(bundle.cards.firstResponseSeconds)}
              icon={Reply}
              tooltip={t("firstResponseTooltip")}
            />
          </>
        )}
      </div>

      <TicketsPerDayChart data={bundle?.charts.daily ?? []} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TicketsByChannelChart data={bundle?.charts.byChannel ?? []} />
        <TicketsBySourceChart data={bundle?.charts.bySource ?? []} />
        <TicketsByDepartmentChart data={bundle?.charts.byDepartment ?? []} />
        <TicketsByClosingReasonChart data={bundle?.charts.byClosingReason ?? []} />
      </div>
    </div>
  )
}
