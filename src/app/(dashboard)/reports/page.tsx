"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Headset, Radio, RefreshCw, ShieldCheck, TrendingUp, type LucideIcon } from "lucide-react"

import { resolvePeriod } from "@/lib/reports/period"
import type { PeriodKey } from "@/lib/reports/types"

import { PeriodFilter } from "@/components/reports/period-filter"
import { OverviewTab } from "@/components/reports/overview-tab"
import { PipelineTab } from "@/components/reports/pipeline-tab"
import { BroadcastsTab } from "@/components/reports/broadcasts-tab"
import { BroadcastRoiTab } from "@/components/reports/broadcast-roi-tab"
import { QualityTab } from "@/components/reports/quality-tab"
import { NpsTab } from "@/components/reports/nps-tab"
import { CommissionsTab } from "@/components/reports/commissions-tab"
import { AttendanceTab } from "@/components/reports/attendance-tab"
import { SlaTab } from "@/components/reports/sla-tab"
import { UserSummaryTab } from "@/components/reports/user-summary-tab"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"

type ReportTab =
  | "overview"
  | "pipeline"
  | "broadcasts"
  | "broadcastRoi"
  | "quality"
  | "satisfaction"
  | "commissions"
  | "attendance"
  | "sla"
  | "userSummary"

const TAB_LABELS: Record<ReportTab, string> = {
  overview: "Visão geral",
  pipeline: "Pipeline & Vendas",
  commissions: "Comissões",
  broadcasts: "Transmissões",
  broadcastRoi: "ROI de Transmissões",
  quality: "Qualidade da conta",
  satisfaction: "Satisfação",
  attendance: "Atendimento",
  sla: "SLA",
  userSummary: "Resumo por usuário",
}

type SectionKey = "sales" | "attendance" | "broadcasts" | "quality"

/** Groups the 10 tabs into the 4 sections navigated at level 1. Order
 *  inside each list is also the display order at level 2, and
 *  `tabs[0]` (after the tickets-gate filter) is what a section pill
 *  navigates to. */
const SECTIONS: { key: SectionKey; label: string; icon: LucideIcon; tabs: ReportTab[] }[] = [
  { key: "sales", label: "Vendas", icon: TrendingUp, tabs: ["overview", "pipeline", "commissions"] },
  {
    key: "attendance",
    label: "Atendimento",
    icon: Headset,
    tabs: ["attendance", "sla", "userSummary", "satisfaction"],
  },
  { key: "broadcasts", label: "Transmissões", icon: Radio, tabs: ["broadcasts", "broadcastRoi"] },
  { key: "quality", label: "Qualidade", icon: ShieldCheck, tabs: ["quality"] },
]

function isPeriodKey(v: string | null): v is PeriodKey {
  return v === "today" || v === "week" || v === "month" || v === "custom"
}

function isReportTab(v: string | null): v is ReportTab {
  return v != null && v in TAB_LABELS
}

/** Shared by all three tickets-rollout-gated tabs — kept as one
 *  helper so a future 4th tab only adds its literal here. */
function isTicketsTab(v: ReportTab): boolean {
  return v === "attendance" || v === "sla" || v === "userSummary"
}

function visibleTabsOf(section: (typeof SECTIONS)[number], ticketsUiEnabled: boolean): ReportTab[] {
  return section.tabs.filter((t) => !isTicketsTab(t) || ticketsUiEnabled)
}

function sectionForTab(tab: ReportTab): (typeof SECTIONS)[number] {
  return SECTIONS.find((s) => s.tabs.includes(tab)) ?? SECTIONS[0]
}

function formatRelativeTime(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60_000)
  if (minutes < 1) return "agora"
  if (minutes === 1) return "há 1 min"
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours === 1 ? "há 1h" : `há ${hours}h`
}

/** Ticks its own relative-time label every 30s so "há X min" doesn't
 *  need the whole page to re-render on an interval. */
function UpdatedAtControl({ lastRefreshedAt, onRefresh }: { lastRefreshedAt: number; onRefresh: () => void }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Atualizado {formatRelativeTime(lastRefreshedAt)}</span>
      <Button variant="outline" size="icon" className="h-7 w-7" onClick={onRefresh} aria-label="Atualizar dados">
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// `useSearchParams` opts the page out of static prerendering unless
// it sits under a Suspense boundary — same split used by
// (auth)/login/page.tsx.
export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsPageInner />
    </Suspense>
  )
}

function ReportsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { ticketsUiEnabled } = useAuth()

  const tabParam = searchParams.get("tab")
  // "attendance" is gated behind the tickets rollout flag — a stale
  // deep link (or a manually edited URL) for an account that doesn't
  // have it falls back to the Overview landing instead of rendering a
  // tab with no matching trigger in the list above it.
  const tab: ReportTab =
    isReportTab(tabParam) && (!isTicketsTab(tabParam) || ticketsUiEnabled) ? tabParam : "overview"
  const section = sectionForTab(tab)
  const sectionTabs = visibleTabsOf(section, ticketsUiEnabled)

  const periodParam = searchParams.get("period")
  // The Transmissões report reads better zoomed out (a single day of
  // broadcast activity is rarely representative) — defaults to "week"
  // when no period is in the URL; every other tab keeps "today".
  const defaultPeriodKey: PeriodKey = tab === "broadcasts" ? "week" : "today"
  const periodKey: PeriodKey = isPeriodKey(periodParam) ? periodParam : defaultPeriodKey
  const fromParam = searchParams.get("from")
  const toParam = searchParams.get("to")

  const period = useMemo(
    () => resolvePeriod(periodKey, fromParam, toParam),
    [periodKey, fromParam, toParam],
  )

  // Bumped by the header's refresh button — passed as a remount `key`
  // to whichever tab is on screen (including Overview) so "Atualizar"
  // re-runs that report's fetch without each tab needing its own
  // refresh plumbing.
  const [refreshNonce, setRefreshNonce] = useState(0)
  // Derived, not stateful — a fresh fetch is triggered by tab/period/
  // refreshNonce changing, so "when was that" is just "now" at the
  // moment any of those last changed, computed in render rather than
  // chased with a second effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lastRefreshedAt = useMemo(() => Date.now(), [tab, period, refreshNonce])

  function buildParams(next: { tab?: ReportTab; period: PeriodKey; from?: string; to?: string }) {
    const params = new URLSearchParams()
    params.set("tab", next.tab ?? tab)
    params.set("period", next.period)
    if (next.period === "custom" && next.from && next.to) {
      params.set("from", next.from)
      params.set("to", next.to)
    }
    return params
  }

  function updatePeriod(next: { period: PeriodKey; from?: string; to?: string }) {
    router.replace(`/reports?${buildParams(next).toString()}`, { scroll: false })
  }

  function updateTab(next: ReportTab) {
    router.replace(
      `/reports?${buildParams({ tab: next, period: periodKey, from: fromParam ?? undefined, to: toParam ?? undefined }).toString()}`,
      { scroll: false },
    )
  }

  function updateSection(nextKey: string) {
    const next = SECTIONS.find((s) => s.key === nextKey) ?? SECTIONS[0]
    const nextTab = visibleTabsOf(next, ticketsUiEnabled)[0] ?? next.tabs[0]
    updateTab(nextTab)
  }

  return (
    <div className="space-y-5">
      {/* Full-bleed sticky header — negative margins cancel out
          <main>'s own padding (dashboard-shell.tsx) so the bar reaches
          the edges while staying flush with the top of the scroll
          area instead of stopping one padding-width short of it. */}
      <div className="sticky top-0 z-10 -mx-4 -mt-4 border-b border-border bg-background/95 px-4 pt-4 pb-3 backdrop-blur-sm sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Relatórios</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Métricas de atendimento, vendas, transmissões e qualidade da conta por período.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {!isTicketsTab(tab) && <PeriodFilter period={period} onChange={updatePeriod} />}
            <UpdatedAtControl lastRefreshedAt={lastRefreshedAt} onRefresh={() => setRefreshNonce((n) => n + 1)} />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {/* Level 1 — section pills (desktop) / compact selector (mobile) */}
          <div className="hidden sm:block">
            <Tabs value={section.key} onValueChange={(v) => updateSection(v as string)}>
              <TabsList data-tour="reports-sections">
                {SECTIONS.map((s) => (
                  <TabsTrigger key={s.key} value={s.key} className="gap-1.5">
                    <s.icon className="h-4 w-4" />
                    {s.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="sm:hidden">
            <Select
              items={Object.fromEntries(SECTIONS.map((s) => [s.key, s.label]))}
              value={section.key}
              onValueChange={(v) => updateSection(v as string)}
            >
              <SelectTrigger className="w-full bg-card">
                <section.icon className="h-4 w-4 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECTIONS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    <s.icon className="h-4 w-4" />
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Level 2 — the active section's tabs. Hidden when a
              section only resolves to one visible tab (Qualidade
              always; Atendimento when ticketsUiEnabled is off) since a
              single-item tab bar has nothing to navigate between. */}
          {sectionTabs.length > 1 && (
            <div className="-mx-1 overflow-x-auto px-1">
              <Tabs value={tab} onValueChange={(v) => updateTab(v as ReportTab)}>
                <TabsList variant="line" data-tour="reports-tabs" className="w-max">
                  {sectionTabs.map((t) => (
                    <TabsTrigger key={t} value={t} className="whitespace-nowrap">
                      {TAB_LABELS[t]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          )}
        </div>
      </div>

      {tab === "overview" && <OverviewTab key={refreshNonce} period={period} />}
      {tab === "pipeline" && <PipelineTab key={refreshNonce} period={period} />}
      {tab === "commissions" && <CommissionsTab key={refreshNonce} period={period} />}
      {tab === "broadcasts" && <BroadcastsTab key={refreshNonce} period={period} />}
      {tab === "broadcastRoi" && <BroadcastRoiTab key={refreshNonce} period={period} />}
      {tab === "quality" && <QualityTab key={refreshNonce} />}
      {tab === "satisfaction" && <NpsTab key={refreshNonce} period={period} />}
      {tab === "attendance" && ticketsUiEnabled && <AttendanceTab key={refreshNonce} />}
      {tab === "sla" && ticketsUiEnabled && <SlaTab key={refreshNonce} />}
      {tab === "userSummary" && ticketsUiEnabled && <UserSummaryTab key={refreshNonce} />}
    </div>
  )
}
