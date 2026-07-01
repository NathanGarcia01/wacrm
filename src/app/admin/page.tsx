import {
  getAccountsPage,
  getChurnSummary,
  getMrrSnapshots,
  getMrrSummary,
  getStatusDistribution,
} from "@/lib/admin/data"
import { STATUS_FILTERS, type SubscriptionStatus } from "@/lib/admin/types"
import { AdminHeader } from "@/components/admin/admin-header"
import { MrrCard } from "@/components/admin/mrr-card"
import { ChurnCard } from "@/components/admin/churn-card"
import { DistributionBar } from "@/components/admin/distribution-bar"
import { FilterPills } from "@/components/admin/filter-pills"
import { AccountsTable } from "@/components/admin/accounts-table"
import { Pagination } from "@/components/admin/pagination"
import { MrrChart } from "@/components/admin/mrr-chart"

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string }>
}

export default async function AdminPage({ searchParams }: PageProps) {
  const params = await searchParams
  const filterKey = STATUS_FILTERS.some((f) => f.key === params.status) ? params.status! : "all"
  const filterStatus =
    (STATUS_FILTERS.find((f) => f.key === filterKey)?.status ?? null) as SubscriptionStatus | null
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1)

  const [accountsPage, distribution, mrr, churn, snapshots] = await Promise.all([
    getAccountsPage(page, filterStatus),
    getStatusDistribution(),
    getMrrSummary(),
    getChurnSummary(),
    getMrrSnapshots(),
  ])

  const totalPages = Math.max(1, Math.ceil(accountsPage.total / accountsPage.pageSize))

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white">
      <AdminHeader />

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <MrrCard mrr={mrr} />
          </div>
          <ChurnCard churn={churn} />
        </div>

        <DistributionBar counts={distribution} />

        <MrrChart snapshots={snapshots} />

        <div className="flex flex-col gap-4">
          <FilterPills active={filterKey} />
          <AccountsTable rows={accountsPage.rows} />
          <Pagination page={page} totalPages={totalPages} status={filterStatus} />
        </div>
      </main>
    </div>
  )
}
