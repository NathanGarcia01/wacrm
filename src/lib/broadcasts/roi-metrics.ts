import type {
  BroadcastRoiCards,
  BroadcastRoiCostBreakdown,
  BroadcastRoiFunnel,
} from '@/lib/reports/types'

/** A deal attributed to a broadcast (or set of broadcasts) that was won. */
export interface AttributedWonDeal {
  /** Total commission across the deal's products. */
  commission: number
  /** ISO timestamp the deal was won. */
  wonAt: string
  /** ISO timestamp the broadcast that reached this deal's contact went out —
   *  used to compute "days to close". For an aggregate (many broadcasts),
   *  pass the specific broadcast's created_at this deal is attributed to. */
  broadcastCreatedAt: string
}

/**
 * Per-category rate × sent-count breakdown. A single broadcast only
 * ever has messages in ONE category (its template's), so on the
 * detail page exactly one of these three is non-zero — the aggregate
 * report sums this across broadcasts of different categories.
 */
export function costBreakdown(args: {
  category: string | null
  sentCount: number
  rateMarketing: number
  rateUtility: number
  rateAuthentication: number
}): BroadcastRoiCostBreakdown {
  const marketing = args.category === 'Marketing' ? args.rateMarketing * args.sentCount : 0
  const utility = args.category === 'Utility' ? args.rateUtility * args.sentCount : 0
  const authentication =
    args.category === 'Authentication' ? args.rateAuthentication * args.sentCount : 0
  return { marketing, utility, authentication, total: marketing + utility + authentication }
}

export function addCostBreakdown(
  a: BroadcastRoiCostBreakdown,
  b: BroadcastRoiCostBreakdown,
): BroadcastRoiCostBreakdown {
  return {
    marketing: a.marketing + b.marketing,
    utility: a.utility + b.utility,
    authentication: a.authentication + b.authentication,
    total: a.total + b.total,
  }
}

const ZERO_COST: BroadcastRoiCostBreakdown = { marketing: 0, utility: 0, authentication: 0, total: 0 }
export { ZERO_COST }

/**
 * Derives every ROI card metric from raw inputs. Shared by the
 * single-broadcast detail page and the period-aggregate Reports tab
 * so the math can't drift between the two surfaces.
 */
export function computeRoiCards(args: {
  cost: BroadcastRoiCostBreakdown
  leadsGenerated: number
  dealsCreated: number
  wonDeals: AttributedWonDeal[]
}): BroadcastRoiCards {
  const { cost, leadsGenerated, dealsCreated, wonDeals } = args
  const commissionGenerated = wonDeals.reduce((sum, d) => sum + d.commission, 0)
  const dealsWon = wonDeals.length

  const daysToCloseSamples = wonDeals.map(
    (d) => (new Date(d.wonAt).getTime() - new Date(d.broadcastCreatedAt).getTime()) / 86_400_000,
  )

  return {
    cost,
    commissionGenerated,
    roiPct: cost.total > 0 ? ((commissionGenerated - cost.total) / cost.total) * 100 : null,
    multiple: cost.total > 0 ? commissionGenerated / cost.total : null,
    leadsGenerated,
    dealsCreated,
    dealsWon,
    conversionRatePct: leadsGenerated > 0 ? (dealsWon / leadsGenerated) * 100 : null,
    avgCommissionPerDeal: dealsWon > 0 ? commissionGenerated / dealsWon : null,
    avgDaysToClose:
      daysToCloseSamples.length > 0
        ? daysToCloseSamples.reduce((sum, d) => sum + d, 0) / daysToCloseSamples.length
        : null,
  }
}

export function buildFunnel(args: {
  sent: number
  replied: number
  dealsCreated: number
  dealsWon: number
}): BroadcastRoiFunnel {
  return args
}
