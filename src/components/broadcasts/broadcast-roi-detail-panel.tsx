'use client';

import { useTranslations } from 'next-intl';
import { DollarSign, TrendingUp, TrendingDown, Users, Target, Percent, Ticket, Clock } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import type { BroadcastRoiDetail } from '@/lib/reports/types';
import { MetricCard } from '@/components/dashboard/metric-card';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import { BroadcastRoiFunnelChart } from '@/components/reports/broadcast-roi-funnel-chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Same headline card / metric grid / funnel / table layout as the
 * Reports > ROI de Transmissões tab (broadcast-roi-tab.tsx), scoped
 * to one broadcast instead of a whole period — shares its
 * translation namespace (reports.broadcastRoiTab) since the labels
 * are identical, plus a few detail-only keys for the deals table.
 */
export function BroadcastRoiDetailPanel({
  detail,
  currency,
  loading,
}: {
  detail: BroadcastRoiDetail | null;
  currency: string;
  loading: boolean;
}) {
  const t = useTranslations('reports.broadcastRoiTab');
  const positive = (detail?.cards.roiPct ?? 0) >= 0;

  if (loading || !detail) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  const { cards, funnel, deals } = detail;

  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border p-4 ${
          positive ? 'border-primary/30 bg-primary/10' : 'border-destructive/30 bg-destructive/10'
        }`}
      >
        <div className="flex items-center gap-2">
          {positive ? (
            <TrendingUp className="h-5 w-5 text-primary" />
          ) : (
            <TrendingDown className="h-5 w-5 text-destructive" />
          )}
          <span className="text-sm font-medium text-muted-foreground">{t('roi')}</span>
        </div>
        <p className={`mt-1 font-mono text-3xl font-bold ${positive ? 'text-primary' : 'text-destructive'}`}>
          {cards.roiPct == null ? '—' : `${cards.roiPct.toFixed(0)}%`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t('roiSubtitle')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          title={t('costTotal')}
          value={formatCurrency(cards.cost.total, currency)}
          icon={DollarSign}
          subtitle={t('costBreakdown', {
            marketing: formatCurrency(cards.cost.marketing, currency),
            utility: formatCurrency(cards.cost.utility, currency),
            authentication: formatCurrency(cards.cost.authentication, currency),
          })}
        />
        <MetricCard
          title={t('commissionGenerated')}
          value={formatCurrency(cards.commissionGenerated, currency)}
          icon={TrendingUp}
        />
        <MetricCard
          title={t('multiple')}
          value={cards.multiple == null ? '—' : `${cards.multiple.toFixed(1)}x`}
          icon={Target}
        />
        <MetricCard
          title={t('leadsGenerated')}
          value={cards.leadsGenerated.toLocaleString()}
          icon={Users}
        />
        <MetricCard
          title={t('conversionRate')}
          value={cards.conversionRatePct == null ? '—' : `${cards.conversionRatePct.toFixed(0)}%`}
          icon={Percent}
          subtitle={t('dealsWon') + ': ' + cards.dealsWon.toLocaleString()}
        />
        <MetricCard
          title={t('avgCommissionPerDeal')}
          value={cards.avgCommissionPerDeal == null ? '—' : formatCurrency(cards.avgCommissionPerDeal, currency)}
          icon={Ticket}
        />
        <MetricCard
          title={t('avgDaysToClose')}
          value={
            cards.avgDaysToClose == null ? '—' : t('avgDaysToCloseValue', { days: cards.avgDaysToClose.toFixed(1) })
          }
          icon={Clock}
        />
        <MetricCard
          title={t('dealsCreated')}
          value={cards.dealsCreated.toLocaleString()}
          icon={Users}
        />
      </div>

      <BroadcastRoiFunnelChart
        stages={[
          { key: 'sent', label: t('funnelSent'), value: funnel.sent },
          { key: 'replied', label: t('funnelReplied'), value: funnel.replied },
          { key: 'dealsCreated', label: t('funnelDealsCreated'), value: funnel.dealsCreated },
          { key: 'dealsWon', label: t('funnelDealsWon'), value: funnel.dealsWon },
        ]}
        loading={false}
        title={t('funnelTitle')}
      />

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold text-foreground">{t('dealsTableTitle')}</h3>
        </div>
        {deals.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">{t('noWonDeals')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colDeal')}</TableHead>
                <TableHead>{t('colContact')}</TableHead>
                <TableHead className="text-right">{t('colValue')}</TableHead>
                <TableHead className="text-right">{t('colCommission')}</TableHead>
                <TableHead className="text-right">{t('colClosedAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deals.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium text-foreground">{d.dealTitle}</TableCell>
                  <TableCell className="text-muted-foreground">{d.contactName ?? '—'}</TableCell>
                  <TableCell className="font-mono text-right tabular-nums">
                    {formatCurrency(d.value, currency)}
                  </TableCell>
                  <TableCell className="font-mono text-right tabular-nums text-gold">
                    {formatCurrency(d.commission, currency)}
                  </TableCell>
                  <TableCell className="font-mono text-right tabular-nums text-muted-foreground">
                    {d.closedAt ? new Date(d.closedAt).toLocaleDateString() : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
