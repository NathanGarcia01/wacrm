'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, BroadcastRecipient, Deal, DealProduct, RecipientStatus } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Loader2,
  Users,
  Send,
  CheckCheck,
  Eye,
  AlertCircle,
  MessageCircle,
  Filter,
  Download,
  ChevronDown,
  Trash2,
  Pause,
  Play,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Trophy,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getBroadcastStatus,
  getRecipientStatus,
} from '@/lib/broadcast-status';

interface StatCardProps {
  label: string;
  value: number;
  total: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, total, icon, color }: StatCardProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          {icon}
        </div>
        <span className="text-xs text-muted-foreground">{pct}%</span>
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

interface FunnelStep {
  label: string;
  value: number;
  color: string;
}

/**
 * Pure-CSS funnel chart: decreasing-width rounded bars.
 * Width is relative to the largest step (typically Sent) so we
 * always render a full bar at the top and proportional tails.
 */
function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const t = useTranslations('broadcasts.detail');
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-foreground">{t('funnel')}</h3>
      <div className="space-y-2">
        {steps.map((step) => {
          const pctOfMax = Math.max(5, Math.round((step.value / max) * 100));
          const pctOfSent =
            steps[0].value > 0
              ? Math.round((step.value / steps[0].value) * 100)
              : 0;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">
                {step.label}
              </span>
              <div className="relative h-7 flex-1 rounded-full bg-muted">
                <div
                  className={`h-7 rounded-full ${step.color} transition-[width] duration-500`}
                  style={{ width: `${pctOfMax}%` }}
                />
                <span className="absolute inset-0 flex items-center px-3 text-xs font-medium text-foreground">
                  {step.value.toLocaleString()}
                  <span className="ml-2 text-muted-foreground/80">
                    ({pctOfSent}%)
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Live status strip shown above the stat cards while a broadcast is
 * scheduled, sending, or paused. Sourced entirely from the polled
 * `broadcast` row — no separate ticking clock, so resolution matches
 * the 5s poll interval (see the effect above), which is plenty for a
 * "~4min remaining" style countdown.
 */
function BatchProgress({ broadcast }: { broadcast: Broadcast }) {
  const t = useTranslations('broadcasts.detail');
  const totalBatches = Math.max(1, Math.ceil(broadcast.total_recipients / (broadcast.batch_size || 1)));
  const processed = broadcast.sent_count + broadcast.failed_count;
  const pct = broadcast.total_recipients > 0 ? Math.round((processed / broadcast.total_recipients) * 100) : 0;

  if (broadcast.status === 'scheduled') {
    return (
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-blue-300">
        {t('scheduledToStart', {
          when: broadcast.scheduled_at ? new Date(broadcast.scheduled_at).toLocaleString() : t('soon'),
        })}
      </div>
    );
  }

  if (broadcast.status === 'paused') {
    return (
      <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 text-sm text-orange-300">
        {t('pausedProgress', { sent: processed, total: broadcast.total_recipients })}
      </div>
    );
  }

  // sending
  const minutesRemaining = broadcast.next_batch_at
    ? Math.max(0, Math.ceil((new Date(broadcast.next_batch_at).getTime() - Date.now()) / 60_000))
    : 0;

  return (
    <div className="space-y-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">
          {t('sendingBatch', { current: broadcast.current_batch + 1, total: totalBatches })}
          {minutesRemaining > 0 ? ` — ${t('awaitingNextBatch', { minutes: minutesRemaining })}` : '...'}
        </span>
        <span className="text-xs text-muted-foreground">{processed}/{broadcast.total_recipients}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div className="h-1.5 rounded-full bg-yellow-500 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface ButtonClickStat {
  label: string;
  count: number;
  pct: number;
}

/**
 * Aggregates button_clicked across the already-fetched recipients list —
 * no separate query needed since the recipients table select('*') already
 * includes the column (migration 029). Percent is of sent_count, matching
 * the funnel chart's convention of using "Sent" as the base.
 */
function ButtonClickTracking({
  recipients,
  sentCount,
}: {
  recipients: BroadcastRecipient[];
  sentCount: number;
}) {
  const t = useTranslations('broadcasts.detail');
  const counts = new Map<string, number>();
  for (const r of recipients) {
    if (!r.button_clicked) continue;
    counts.set(r.button_clicked, (counts.get(r.button_clicked) ?? 0) + 1);
  }
  const stats: ButtonClickStat[] = Array.from(counts.entries())
    .map(([label, count]) => ({
      label,
      count,
      pct: sentCount > 0 ? Math.round((count / sentCount) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-foreground">{t('buttonTracking')}</h3>
      {stats.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('buttonTrackingWaiting')}</p>
      ) : (
        <div className="space-y-2">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span className="font-medium text-foreground">{stat.label}</span>
              <span className="text-muted-foreground">
                {t('buttonClickCount', { count: stat.count, pct: stat.pct })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface RoiStatProps {
  label: string;
  value: string;
  icon: React.ReactNode;
}

function RoiStat({ label, value, icon }: RoiStatProps) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

/**
 * "ROI do Disparo" card — lets the agent record what they paid Meta per
 * message, then derives cost/revenue/commission from the deals won by
 * this broadcast's recipients. `wonDeals` is pre-filtered by the caller
 * (contact in broadcast_recipients, status='won', won_at after the
 * broadcast was created) so this component only aggregates and renders.
 */
function BroadcastRoi({
  broadcast,
  wonDeals,
  currency,
  onSaveCost,
}: {
  broadcast: Broadcast;
  wonDeals: (Deal & { products?: DealProduct[] })[];
  currency: string;
  onSaveCost: (cost: number) => Promise<void>;
}) {
  const t = useTranslations('broadcasts.detail');
  const [costInput, setCostInput] = useState(String(broadcast.cost_per_message ?? 0));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCostInput(String(broadcast.cost_per_message ?? 0));
  }, [broadcast.cost_per_message]);

  const costPerMessage = Number(costInput) || 0;
  const totalCost = costPerMessage * broadcast.sent_count;
  const wonValue = wonDeals.reduce((sum, d) => sum + (d.value || 0), 0);
  const commission = wonDeals.reduce(
    (sum, d) => sum + (d.products ?? []).reduce((s, p) => s + (p.commission_value || 0), 0),
    0,
  );
  const roiPct = totalCost > 0 ? ((wonValue - totalCost) / totalCost) * 100 : null;
  const multiplier = totalCost > 0 ? wonValue / totalCost : null;
  const positive = (roiPct ?? 0) >= 0;

  async function handleSave() {
    setSaving(true);
    try {
      await onSaveCost(costPerMessage);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{t('roiTitle')}</h3>
        <div className="flex items-center gap-2">
          <label htmlFor="roi-cost-per-message" className="text-xs text-muted-foreground">
            {t('roiCostPerMessage')}
          </label>
          <input
            id="roi-cost-per-message"
            type="number"
            min="0"
            step="0.0001"
            value={costInput}
            onChange={(e) => setCostInput(e.target.value)}
            className="w-28 rounded-md border border-border bg-muted px-2 py-1 text-sm text-foreground outline-none focus:border-primary/50"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            disabled={saving || costPerMessage === (broadcast.cost_per_message ?? 0)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {saving ? t('roiSaving') : t('roiSave')}
          </Button>
        </div>
      </div>

      {roiPct === null || multiplier === null ? (
        <p className="text-sm text-muted-foreground">{t('roiSetCost')}</p>
      ) : (
        <div
          className={cn(
            'rounded-lg border p-4',
            positive ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10',
          )}
        >
          <div className="flex items-center gap-2">
            {positive ? (
              <TrendingUp className="h-5 w-5 text-green-400" />
            ) : (
              <TrendingDown className="h-5 w-5 text-red-400" />
            )}
            <span
              className={cn('text-3xl font-bold', positive ? 'text-green-400' : 'text-red-400')}
            >
              {roiPct.toFixed(0)}%
            </span>
          </div>
          <p className={cn('mt-1 text-sm', positive ? 'text-green-300' : 'text-red-300')}>
            {t('roiMultiplier', { multiplier: multiplier.toFixed(1) })}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <RoiStat
          label={t('roiTotalCost')}
          value={formatCurrency(totalCost, 'BRL')}
          icon={<DollarSign className="h-3.5 w-3.5" />}
        />
        <RoiStat
          label={t('roiWonDeals')}
          value={String(wonDeals.length)}
          icon={<Trophy className="h-3.5 w-3.5" />}
        />
        <RoiStat
          label={t('roiWonValue')}
          value={formatCurrency(wonValue, currency)}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
        />
        <RoiStat
          label={t('roiCommission')}
          value={formatCurrency(commission, currency)}
          icon={<DollarSign className="h-3.5 w-3.5" />}
        />
      </div>

      {wonDeals.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('roiNoWonDeals')}</p>
      )}
    </div>
  );
}

const RECIPIENT_STATUSES: readonly RecipientStatus[] = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
];

/**
 * CSV export helper — RFC 4180 quoting. Quote every field so
 * commas/newlines/quotes round-trip cleanly.
 */
function toCsv(rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function BroadcastDetailPage() {
  const t = useTranslations('broadcasts.detail');
  const tStatus = useTranslations('broadcasts.status');
  const tRecipientStatus = useTranslations('broadcasts.recipientStatus');
  const params = useParams();
  const router = useRouter();
  const broadcastId = params.id as string;
  const { defaultCurrency } = useAuth();

  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [wonDeals, setWonDeals] = useState<(Deal & { products?: DealProduct[] })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>(
    'all',
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pausing, setPausing] = useState(false);

  async function fetchData() {
    try {
      const supabase = createClient();

      const { data: bc, error: bcError } = await supabase
        .from('broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();

      if (bcError) throw bcError;
      setBroadcast(bc);

      const { data: recs, error: recsError } = await supabase
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)')
        .eq('broadcast_id', broadcastId)
        .order('created_at', { ascending: false });

      if (recsError) throw recsError;
      setRecipients(recs ?? []);

      // ROI card: deals won by a contact this broadcast reached, closed
      // after the broadcast went out — so a win that predates the send
      // (unrelated to it) isn't counted as attributed revenue.
      const contactIds = Array.from(
        new Set((recs ?? []).map((r) => r.contact_id).filter((id): id is string => !!id)),
      );
      if (contactIds.length > 0 && bc) {
        const { data: deals } = await supabase
          .from('deals')
          .select('*, products:deal_products(*)')
          .in('contact_id', contactIds)
          .eq('status', 'won')
          .gt('won_at', bc.created_at);
        setWonDeals((deals as (Deal & { products?: DealProduct[] })[] | null) ?? []);
      } else {
        setWonDeals([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveCost(cost: number) {
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from('broadcasts')
      .update({ cost_per_message: cost })
      .eq('id', broadcastId);
    if (updateError) {
      toast.error(t('roiSaveFailed', { message: updateError.message }));
      return;
    }
    toast.success(t('roiSaveSuccess'));
    setBroadcast((prev) => (prev ? { ...prev, cost_per_message: cost } : prev));
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcastId]);

  // Poll while actively sending so the batch progress / countdown and
  // recipient statuses stay fresh without a manual refresh — mirrors
  // the list page's polling.
  useEffect(() => {
    if (broadcast?.status !== 'sending') return;
    const timer = setInterval(fetchData, 5_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast?.status]);

  async function handleTogglePause() {
    if (!broadcast) return;
    setPausing(true);
    const supabase = createClient();
    const resuming = broadcast.status === 'paused';
    const { error: updateError } = await supabase
      .from('broadcasts')
      .update(
        resuming
          ? { status: 'sending', next_batch_at: new Date().toISOString() }
          : { status: 'paused' },
      )
      .eq('id', broadcastId);
    setPausing(false);
    if (updateError) {
      toast.error(
        resuming
          ? t('resumeFailed', { message: updateError.message })
          : t('pauseFailed', { message: updateError.message }),
      );
      return;
    }
    toast.success(resuming ? t('broadcastResumed') : t('broadcastPaused'));
    fetchData();
  }

  const filteredRecipients = useMemo(
    () =>
      statusFilter === 'all'
        ? recipients
        : recipients.filter((r) => r.status === statusFilter),
    [recipients, statusFilter],
  );

  function handleExport() {
    if (!broadcast) return;
    const header = [
      t('csvContact'),
      t('csvPhone'),
      t('csvStatus'),
      t('csvSentAt'),
      t('csvDeliveredAt'),
      t('csvReadAt'),
      t('csvRepliedAt'),
      t('csvError'),
    ];
    const rows = recipients.map((r) => [
      r.contact?.name ?? '',
      r.contact?.phone ?? '',
      r.status,
      r.sent_at ?? '',
      r.delivered_at ?? '',
      r.read_at ?? '',
      r.replied_at ?? '',
      r.error_message ?? '',
    ]);
    const csv = toCsv([header, ...rows]);
    const safeName = broadcast.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    downloadBlob(`broadcast-${safeName}-${broadcastId.slice(0, 8)}.csv`, csv);
  }

  async function handleDelete() {
    setDeleting(true);
    const supabase = createClient();
    // broadcast_recipients cascades on broadcasts.id (migration 001), so a
    // single delete is sufficient — the aggregate trigger in migration 003
    // is defined on broadcast_recipients but fires only on its own row
    // changes, not on a cascaded drop of the parent row.
    const { error: delErr } = await supabase
      .from('broadcasts')
      .delete()
      .eq('id', broadcastId);
    setDeleting(false);
    if (delErr) {
      toast.error(t('deleteFailed', { message: delErr.message }));
      return;
    }
    toast.success(t('broadcastDeleted'));
    router.push('/broadcasts');
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !broadcast) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error ?? t('broadcastNotFound')}</p>
        <Button variant="outline" onClick={() => router.push('/broadcasts')}>
          {t('backToBroadcasts')}
        </Button>
      </div>
    );
  }

  const status = getBroadcastStatus(broadcast.status);

  const funnelSteps: FunnelStep[] = [
    { label: t('funnelSent'), value: broadcast.sent_count, color: 'bg-primary' },
    { label: t('funnelDelivered'), value: broadcast.delivered_count, color: 'bg-teal-500' },
    { label: t('funnelRead'), value: broadcast.read_count, color: 'bg-blue-500' },
    { label: t('funnelReplied'), value: broadcast.replied_count, color: 'bg-indigo-500' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/broadcasts')}
            className="border-border"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{broadcast.name}</h1>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
              >
                {tStatus(status.labelKey)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span>{t('templateLabel')}: {broadcast.template_name}</span>
              <span>-</span>
              <span>
                {t('createdOn')} {new Date(broadcast.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
        {(broadcast.status === 'sending' || broadcast.status === 'paused') && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleTogglePause}
            disabled={pausing}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {broadcast.status === 'paused' ? (
              <>
                <Play className="h-3.5 w-3.5" />
                {pausing ? t('resuming') : t('resume')}
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5" />
                {pausing ? t('pausing') : t('pause')}
              </>
            )}
          </Button>
        )}

        {/* Delete — inline-confirm pattern matches the pipeline-settings
            "Delete Pipeline" flow. Mid-send broadcasts can't be deleted
            because orphaning in-flight Meta messages would leave the
            funnel inconsistent. */}
        {confirmDelete ? (
          <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm">
            <span className="text-red-300">{t('confirmDeleteBroadcast')}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="h-7 border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="h-7 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? t('deleting') : t('confirm')}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={broadcast.status === 'sending'}
            onClick={() => setConfirmDelete(true)}
            title={
              broadcast.status === 'sending'
                ? t('cannotDeleteWhileSending')
                : t('deleteBroadcastTitle')
            }
            className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('delete')}
          </Button>
        )}
        </div>
      </div>

      {/* Batch progress — only meaningful while the cron worker is
          actively pacing this broadcast. Scheduled shows the start
          time; sending shows current batch + countdown to the next
          one; paused explains why nothing is moving. */}
      {broadcast.status !== 'draft' && broadcast.status !== 'sent' && broadcast.status !== 'failed' && (
        <BatchProgress broadcast={broadcast} />
      )}

      {/* Stats — 6 cards: Total / Sent / Delivered / Read / Replied / Failed */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label={t('statTotalRecipients')}
          value={broadcast.total_recipients}
          total={broadcast.total_recipients}
          icon={<Users className="h-4 w-4" />}
          color="bg-muted text-muted-foreground"
        />
        <StatCard
          label={t('statSent')}
          value={broadcast.sent_count}
          total={broadcast.total_recipients}
          icon={<Send className="h-4 w-4" />}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          label={t('statDelivered')}
          value={broadcast.delivered_count}
          total={broadcast.total_recipients}
          icon={<CheckCheck className="h-4 w-4" />}
          color="bg-teal-500/10 text-teal-400"
        />
        <StatCard
          label={t('statRead')}
          value={broadcast.read_count}
          total={broadcast.total_recipients}
          icon={<Eye className="h-4 w-4" />}
          color="bg-blue-500/10 text-blue-400"
        />
        <StatCard
          label={t('statReplied')}
          value={broadcast.replied_count}
          total={broadcast.total_recipients}
          icon={<MessageCircle className="h-4 w-4" />}
          color="bg-indigo-500/10 text-indigo-400"
        />
        <StatCard
          label={t('statFailed')}
          value={broadcast.failed_count}
          total={broadcast.total_recipients}
          icon={<AlertCircle className="h-4 w-4" />}
          color="bg-red-500/10 text-red-400"
        />
      </div>

      <FunnelChart steps={funnelSteps} />

      <BroadcastRoi
        broadcast={broadcast}
        wonDeals={wonDeals}
        currency={defaultCurrency}
        onSaveCost={handleSaveCost}
      />

      <ButtonClickTracking recipients={recipients} sentCount={broadcast.sent_count} />

      {/* Recipients Table */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">
            {statusFilter !== 'all'
              ? t('recipientsCountOf', { count: filteredRecipients.length, total: recipients.length })
              : t('recipientsCount', { count: filteredRecipients.length })}
          </h2>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border text-muted-foreground hover:bg-muted"
                  />
                }
              >
                <Filter className="h-3.5 w-3.5" />
                {statusFilter === 'all'
                  ? t('allStatuses')
                  : tRecipientStatus(getRecipientStatus(statusFilter).labelKey)}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="border-border bg-popover">
                <DropdownMenuItem
                  onClick={() => setStatusFilter('all')}
                  className={
                    statusFilter === 'all' ? 'text-primary' : 'text-popover-foreground'
                  }
                >
                  {t('allStatuses')}
                </DropdownMenuItem>
                {RECIPIENT_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={
                      statusFilter === s
                        ? 'text-primary'
                        : 'text-popover-foreground'
                    }
                  >
                    {tRecipientStatus(getRecipientStatus(s).labelKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={recipients.length === 0}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" />
              {t('exportCsv')}
            </Button>
          </div>
        </div>

        {filteredRecipients.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {recipients.length === 0
                ? t('noRecipientsFound')
                : t('noRecipientsMatchFilter')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">{t('tableContact')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('tablePhone')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('tableStatus')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('tableSent')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('tableDelivered')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('tableRead')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('tableError')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecipients.map((recipient) => {
                  const rStatus = getRecipientStatus(recipient.status);
                  return (
                    <TableRow key={recipient.id} className="border-border">
                      <TableCell className="font-medium text-foreground">
                        {recipient.contact?.name ?? t('unknownContact')}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.contact?.phone ?? '-'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${rStatus.classes}`}
                        >
                          {tRecipientStatus(rStatus.labelKey)}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.sent_at
                          ? new Date(recipient.sent_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.delivered_at
                          ? new Date(recipient.delivered_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.read_at
                          ? new Date(recipient.read_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-red-400">
                        {recipient.error_message ?? '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
