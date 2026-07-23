import { redirect } from "next/navigation"
import {
  computeExecutiveMetrics,
  getAccountsPage,
  getChurnSummary,
  getInactiveAccounts,
  getMrrSnapshots,
  getMrrSummary,
  getNewAccountsPerMonth,
  getPastDueAccounts,
  getPlans,
  getStatusDistribution,
  getTrialsExpiringSoon,
  getTrialsExpiringSoonCount,
} from "@/lib/admin/data"
import { requireAdminUser } from "@/lib/admin/require-admin"
import { STATUS_FILTERS, type SubscriptionStatus } from "@/lib/admin/types"
import { AdminHeader } from "@/components/admin/admin-header"
import { MrrCard } from "@/components/admin/mrr-card"
import { ChurnCard } from "@/components/admin/churn-card"
import { DistributionBar } from "@/components/admin/distribution-bar"
import { FilterPills } from "@/components/admin/filter-pills"
import { AccountsFilters } from "@/components/admin/accounts-filters"
import { AccountsTable } from "@/components/admin/accounts-table"
import { Pagination } from "@/components/admin/pagination"
import { MrrChart } from "@/components/admin/mrr-chart"
import { KpiRow } from "@/components/admin/kpi-row"
import { MrrPlanPie } from "@/components/admin/mrr-plan-pie"
import { NewAccountsChart } from "@/components/admin/new-accounts-chart"
import { AlertCards } from "@/components/admin/alert-cards"

const TRIAL_KPI_DAYS = 7
const TRIAL_ALERT_DAYS = 3
const INACTIVE_ALERT_DAYS = 7

interface PageProps {
  searchParams: Promise<{
    status?: string
    page?: string
    search?: string
    plan?: string
    trialExpiring?: string
    from?: string
    to?: string
  }>
}

export default async function AdminPage({ searchParams }: PageProps) {
  // Middleware already gates /admin/* on a validly-signed cookie, but
  // that check is pure crypto (no DB) — this is the independent
  // re-check that confirms the admin_users row still exists/is
  // active, and is what actually carries the role down to the UI.
  const currentAdmin = await requireAdminUser()
  if (!currentAdmin) redirect("/admin/login")

  const params = await searchParams
  const filterKey = STATUS_FILTERS.some((f) => f.key === params.status) ? params.status! : "all"
  const filterStatus =
    (STATUS_FILTERS.find((f) => f.key === filterKey)?.status ?? null) as SubscriptionStatus | null
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1)

  // Preserved across status-pill / pagination links so switching one
  // filter doesn't silently drop the others — see filter-pills.tsx /
  // pagination.tsx.
  const otherParams: Record<string, string> = {}
  if (params.search) otherParams.search = params.search
  if (params.plan) otherParams.plan = params.plan
  if (params.trialExpiring) otherParams.trialExpiring = params.trialExpiring
  if (params.from) otherParams.from = params.from
  if (params.to) otherParams.to = params.to

  const accountsFilterOptions = {
    search: params.search,
    planId: params.plan,
    trialExpiringWithinDays: params.trialExpiring === "1" ? 7 : undefined,
    createdFrom: params.from,
    createdTo: params.to,
  }

  const [
    accountsPage,
    distribution,
    mrr,
    churn,
    snapshots,
    newAccountsByMonth,
    trialsExpiringSoonCount,
    plans,
    pastDueAccounts,
    trialsExpiringSoonList,
    inactiveAccounts,
  ] = await Promise.all([
    getAccountsPage(page, filterStatus, accountsFilterOptions),
    getStatusDistribution(),
    getMrrSummary(),
    getChurnSummary(),
    getMrrSnapshots(),
    getNewAccountsPerMonth(),
    getTrialsExpiringSoonCount(TRIAL_KPI_DAYS),
    getPlans(),
    getPastDueAccounts(),
    getTrialsExpiringSoon(TRIAL_ALERT_DAYS),
    getInactiveAccounts(INACTIVE_ALERT_DAYS),
  ])

  const executiveMetrics = computeExecutiveMetrics(
    mrr,
    churn,
    distribution,
    snapshots,
    trialsExpiringSoonCount,
  )

  const totalPages = Math.max(1, Math.ceil(accountsPage.total / accountsPage.pageSize))

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white">
      <AdminHeader admin={currentAdmin} />

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6">
        <AlertCards
          pastDue={pastDueAccounts}
          trialsExpiring={trialsExpiringSoonList}
          inactive={inactiveAccounts}
          plans={plans}
          role={currentAdmin.role}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <MrrCard mrr={mrr} trendPercent={executiveMetrics.mrrTrendPercent} />
          </div>
          <ChurnCard churn={churn} />
        </div>

        <KpiRow metrics={executiveMetrics} />

        <DistributionBar counts={distribution} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MrrPlanPie byPlan={mrr.byPlan} />
          <NewAccountsChart points={newAccountsByMonth} />
        </div>

        <MrrChart snapshots={snapshots} />

        <div className="flex flex-col gap-4">
          <AccountsFilters plans={plans} />
          <FilterPills active={filterKey} otherParams={otherParams} />
          <AccountsTable rows={accountsPage.rows} plans={plans} role={currentAdmin.role} />
          <Pagination
            page={page}
            totalPages={totalPages}
            status={filterStatus}
            otherParams={otherParams}
          />
        </div>
      </main>
    </div>
  )
}
