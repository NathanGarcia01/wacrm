"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { formatCurrency } from '@/lib/currency'
import {
  MessageSquare,
  UserPlus,
  DollarSign,
  Send,
  Star,
} from 'lucide-react'

import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'
import { resolvePeriod } from '@/lib/reports/period'
import type { PeriodKey } from '@/lib/reports/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ConversionFunnelChart } from '@/components/dashboard/conversion-funnel-chart'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { PeriodFilter } from '@/components/reports/period-filter'

type RangeDays = 7 | 30 | 90

const DASHBOARD_PERIOD_KEY = 'wacrm.dashboard.period'
const DASHBOARD_PERIOD_FROM_KEY = 'wacrm.dashboard.period.from'
const DASHBOARD_PERIOD_TO_KEY = 'wacrm.dashboard.period.to'
const DEFAULT_PERIOD_KEY: PeriodKey = 'month'

function loadStoredPeriodKey(): PeriodKey {
  if (typeof window === 'undefined') return DEFAULT_PERIOD_KEY
  const stored = window.localStorage.getItem(DASHBOARD_PERIOD_KEY)
  if (stored === 'today' || stored === 'week' || stored === 'month' || stored === 'custom') {
    return stored
  }
  return DEFAULT_PERIOD_KEY
}

export default function DashboardPage() {
  const t = useTranslations('dashboard')
  const { defaultCurrency, profile } = useAuth()

  // Period filter — persisted to localStorage (not the URL, unlike
  // Reports) since the dashboard is a single fixed page, not something
  // users deep-link into with a specific period in mind.
  const [periodKey, setPeriodKey] = useState<PeriodKey>(DEFAULT_PERIOD_KEY)
  const [customFrom, setCustomFrom] = useState<string | undefined>(undefined)
  const [customTo, setCustomTo] = useState<string | undefined>(undefined)
  useEffect(() => {
    setPeriodKey(loadStoredPeriodKey())
    setCustomFrom(window.localStorage.getItem(DASHBOARD_PERIOD_FROM_KEY) ?? undefined)
    setCustomTo(window.localStorage.getItem(DASHBOARD_PERIOD_TO_KEY) ?? undefined)
  }, [])
  const period = useMemo(
    () => resolvePeriod(periodKey, customFrom, customTo),
    [periodKey, customFrom, customTo],
  )
  const handlePeriodChange = useCallback(
    (next: { period: PeriodKey; from?: string; to?: string }) => {
      setPeriodKey(next.period)
      setCustomFrom(next.from)
      setCustomTo(next.to)
      window.localStorage.setItem(DASHBOARD_PERIOD_KEY, next.period)
      if (next.period === 'custom' && next.from && next.to) {
        window.localStorage.setItem(DASHBOARD_PERIOD_FROM_KEY, next.from)
        window.localStorage.setItem(DASHBOARD_PERIOD_TO_KEY, next.to)
      }
    },
    [],
  )

  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [range, setRange] = useState<RangeDays>(30)
  // Keep a cache per range so switching tabs doesn't re-fetch what we
  // already have. Ranges the user hasn't opened yet stay null and
  // trigger a fetch on first view.
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(true)

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    // Metrics + response time are period-scoped (flow data); pipeline
    // donut and the activity feed are deliberately NOT (live snapshot /
    // recent-activity log — see MetricsBundle and loadActivity).
    setMetricsLoading(true)
    void loadMetrics(db, period)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    void loadConversationsSeries(db, 30)
      .then((s) => setSeries((prev) => ({ ...prev, 30: s })))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false))

    void loadPipelineDonut(db)
      .then((p) => setPipeline(p))
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false))

    setResponseTimeLoading(true)
    void loadResponseTime(db, period)
      .then((r) => setResponseTime(r))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false))

    // Fetch up to 50 so the biggest page-size option in the feed
    // (50 rows) is already in memory — switching sizes then becomes
    // a pure client-side slice with no extra round trip.
    void loadActivity(db, 50, t)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false))
  }, [t, period])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Range switch handler — kept in an event callback (not an effect)
  // so the setState calls stay out of the react-hooks/set-state-in-effect
  // rule's way. The cached bucket check means switching back to a
  // previously-viewed range is instant and doesn't re-fetch.
  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      if (series[r] !== null) return
      setSeriesLoading(true)
      const db = createClient()
      loadConversationsSeries(db, r)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false))
    },
    [series],
  )

  const firstName = profile?.full_name?.split(' ')[0]
  const greeting = t(greetingKeyForHour(new Date().getHours()))

  return (
    <div className="space-y-5">
      {/* Header — font-display is reserved for exactly this kind of
          one-off, high-visibility moment; the rest of the dashboard
          (KPI labels, chart headers, activity rows) stays font-sans. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-foreground">
            {greeting}
            {firstName && (
              <>
                {', '}
                <span className="text-primary">{firstName}</span>
              </>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <PeriodFilter period={period} onChange={handlePeriodChange} />
      </div>

      {/* Metric cards — "Conversas ativas" and "Valor em negociação"
          are live snapshots and stay unaffected by the period filter
          above; the rest (new contacts, messages sent, NPS) are
          scoped to the selected period. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('activeConversations')}
              value={metrics.activeConversations.current.toLocaleString()}
              icon={MessageSquare}
              delta={{
                sign: metrics.activeConversations.previous,
                label: deltaLabel(t, metrics.activeConversations.previous, t('newTodayVsYesterday')),
              }}
            />
            <MetricCard
              title={t('newContacts')}
              value={metrics.newContacts.current.toLocaleString()}
              icon={UserPlus}
              delta={{
                sign: metrics.newContacts.current - metrics.newContacts.previous,
                label: deltaLabel(
                  t,
                  metrics.newContacts.current - metrics.newContacts.previous,
                  t('vsPreviousPeriod'),
                ),
              }}
            />
            <MetricCard
              title={t('openDealsValue')}
              value={formatCurrency(metrics.openDealsValue, defaultCurrency)}
              icon={DollarSign}
              subtitle={t('openDealsCount', { count: metrics.openDealsCount })}
            />
            <MetricCard
              title={t('messagesSent')}
              value={metrics.messagesSent.current.toLocaleString()}
              icon={Send}
              delta={{
                sign: metrics.messagesSent.current - metrics.messagesSent.previous,
                label: deltaLabel(
                  t,
                  metrics.messagesSent.current - metrics.messagesSent.previous,
                  t('vsPreviousPeriod'),
                ),
              }}
            />
            <MetricCard
              title={t('npsAvgRating')}
              value={
                metrics.nps.avgRating == null
                  ? '—'
                  : `⭐ ${metrics.nps.avgRating.toFixed(1)}/5`
              }
              icon={Star}
              subtitle={t('npsSubtitle', {
                responses: metrics.nps.totalResponses,
                rate:
                  metrics.nps.responseRatePct == null
                    ? '—'
                    : `${metrics.nps.responseRatePct.toFixed(0)}%`,
              })}
            />
          </>
        )}
      </div>

      {/* Quick actions */}
      <QuickActions />

      {/* Conversion funnel — the redesign's signature piece, full width
          and above the rest of the charts so it reads first. */}
      <ConversionFunnelChart data={pipeline} loading={pipelineLoading} />

      {/* Charts row */}
      {/* items-stretch (the grid default) stretches the two columns to
          match the tallest sibling; adding h-full on each wrapper and
          on the inner panels makes both cards actually fill that
          stretched height so their rounded borders line up. Without
          this, the pipeline card rendered at its natural (shorter)
          height while the line chart drove the row height. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-3">
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            range={range}
            onRangeChange={handleRangeChange}
          />
        </div>
        <div className="h-full lg:col-span-2">
          <PipelineDonut
            data={pipeline}
            loading={pipelineLoading}
            currency={defaultCurrency}
          />
        </div>
      </div>

      {/* Response time */}
      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

      {/* Activity feed */}
      <ActivityFeed items={activity} loading={activityLoading} />
    </div>
  )
}

// ------------------------------------------------------------

function greetingKeyForHour(hour: number): 'greetingMorning' | 'greetingAfternoon' | 'greetingEvening' {
  if (hour < 12) return 'greetingMorning'
  if (hour < 18) return 'greetingAfternoon'
  return 'greetingEvening'
}

function deltaLabel(
  t: (key: string, values?: Record<string, string | number>) => string,
  delta: number,
  suffix: string,
): string {
  if (delta === 0) return t('noChange', { suffix })
  const sign = delta > 0 ? '+' : ''
  return t('delta', { sign, value: delta.toLocaleString(), suffix })
}
