'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Radio, Plus, Loader2, Send, CalendarClock, Pause, MessageSquareText, Ban } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { usePlanFeatures } from '@/hooks/use-feature-gate';
import { GatedButton } from '@/components/ui/gated-button';
import { getBroadcastStatus } from '@/lib/broadcast-status';
import { resolvePeriod } from '@/lib/reports/period';
import { MetricCard } from '@/components/dashboard/metric-card';
import {
  BroadcastFilterBar,
  type BroadcastFilters,
  type WhatsAppChannelOption,
} from '@/components/broadcasts/broadcast-filter-bar';

interface BroadcastsSummary {
  sending_count: number;
  scheduled_count: number;
  paused_count: number;
  sent_this_month_count: number;
  blocked_phones_count: number;
}

/**
 * Poll cadence while any broadcast is sending. Kept modest so we don't
 * beat on Supabase — the aggregate trigger in migration 003 keeps
 * counts consistent; we just need to surface the freshest snapshot.
 */
const POLL_INTERVAL_MS = 5_000;

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function RateCell({
  value,
  total,
  color,
}: {
  value: number;
  total: number;
  /** Tailwind bg class for the fill, e.g. "bg-primary" */
  color: string;
}) {
  const pct = percent(value, total);
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {pct}%
      </span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const BROADCAST_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'failed', 'paused'] as const;
const BROADCAST_CATEGORIES = ['marketing', 'utility', 'authentication'] as const;
const PERIOD_KEYS = ['today', 'week', 'month', 'custom'] as const;

/** Reconstructs BroadcastFilters from the URL on first render, so a
 *  bookmarked/shared link or a back-navigation restores the exact
 *  same filtered view — same convention as the Contacts page filters. */
function filtersFromSearchParams(params: URLSearchParams): BroadcastFilters {
  const status = params.get('status');
  const period = params.get('period');
  const category = params.get('category');
  return {
    status: status && (BROADCAST_STATUSES as readonly string[]).includes(status) ? (status as BroadcastFilters['status']) : 'all',
    tagIds: params.get('tags') ? params.get('tags')!.split(',').filter(Boolean) : [],
    periodKey: period && (PERIOD_KEYS as readonly string[]).includes(period) ? (period as BroadcastFilters['periodKey']) : 'all',
    customFrom: params.get('from') ?? undefined,
    customTo: params.get('to') ?? undefined,
    channelId: params.get('channel') ?? '',
    category: category && (BROADCAST_CATEGORIES as readonly string[]).includes(category) ? (category as BroadcastFilters['category']) : 'all',
    search: params.get('search') ?? '',
  };
}

export default function BroadcastsPage() {
  const t = useTranslations('broadcasts.list');
  const tStatus = useTranslations('broadcasts.status');
  const router = useRouter();
  const searchParams = useSearchParams();
  const canCreate = useCan('send-messages');
  const { accountId } = useAuth();
  const { maxBroadcastsPerMonth } = usePlanFeatures();
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [channels, setChannels] = useState<WhatsAppChannelOption[]>([]);
  const [filters, setFilters] = useState<BroadcastFilters>(() => filtersFromSearchParams(searchParams));
  const [summary, setSummary] = useState<BroadcastsSummary | null>(null);

  // Fase 5, Etapa 4 — current-state summary cards (sending/scheduled/
  // paused counts + this-month sent count + active opt-out blocks),
  // computed in the database (get_broadcasts_summary, migration 098)
  // rather than derived from the already-loaded broadcasts list —
  // that list is itself filtered/paginated by the UI and would never
  // reliably reflect "right now" totals.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc('get_broadcasts_summary', {
        p_account_id: accountId,
      });
      if (!cancelled && !rpcError) setSummary(data as BroadcastsSummary);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // Mirrors every filter into the URL — same convention as the
  // Contacts page. `tags`/`period`/`from`/`to`/`channel`/`category`/
  // `search` all round-trip through filtersFromSearchParams above.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.status !== 'all') params.set('status', filters.status);
    if (filters.tagIds.length > 0) params.set('tags', filters.tagIds.join(','));
    if (filters.periodKey !== 'all') {
      params.set('period', filters.periodKey);
      if (filters.periodKey === 'custom') {
        if (filters.customFrom) params.set('from', filters.customFrom);
        if (filters.customTo) params.set('to', filters.customTo);
      }
    }
    if (filters.channelId) params.set('channel', filters.channelId);
    if (filters.category !== 'all') params.set('category', filters.category);
    if (filters.search.trim()) params.set('search', filters.search.trim());

    const qs = params.toString();
    router.replace(qs ? `/broadcasts?${qs}` : '/broadcasts', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Used to kick off polling only while something is actively sending.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchBroadcasts() {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setBroadcasts(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBroadcasts();
  }, []);

  // Tags for the audience-tag filter — same pattern as Pipelines/Contacts.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from('tags').select('*').order('name');
      if (!cancelled) setTags((data ?? []) as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // Active WhatsApp channels — the channel filter only renders once the
  // account actually has more than one (see BroadcastFilterBar).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/whatsapp/channels');
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const active: WhatsAppChannelOption[] = (data.channels ?? []).filter(
          (c: { is_active: boolean }) => c.is_active,
        );
        setChannels(active);
      } catch {
        // Best-effort — leaving channels empty just hides the filter.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const period = useMemo(
    () =>
      filters.periodKey === 'all'
        ? null
        : resolvePeriod(filters.periodKey, filters.customFrom, filters.customTo),
    [filters.periodKey, filters.customFrom, filters.customTo],
  );

  // Monthly usage counter — only meaningful for a plan with a finite
  // cap (Starter, 500/month); Pro/Business read maxBroadcastsPerMonth
  // as Infinity, so the bar just doesn't render for them.
  const broadcastsThisMonth = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return broadcasts.filter((b) => new Date(b.created_at) >= monthStart).length;
  }, [broadcasts]);

  const filteredBroadcasts = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return broadcasts.filter((b) => {
      if (filters.status !== 'all' && b.status !== filters.status) return false;
      if (filters.channelId !== '' && b.channel_id !== filters.channelId) return false;
      if (filters.category !== 'all' && b.category !== filters.category) return false;
      if (search && !b.name.toLowerCase().includes(search)) return false;
      if (filters.tagIds.length > 0) {
        const audienceTagIds = (b.audience_filter?.tagIds as string[] | undefined) ?? [];
        if (!filters.tagIds.some((id) => audienceTagIds.includes(id))) return false;
      }
      if (period) {
        const effectiveDate = b.scheduled_at ?? b.created_at;
        if (effectiveDate < period.startISO || effectiveDate >= period.endISO) return false;
      }
      return true;
    });
  }, [broadcasts, filters, period]);

  const anySending = useMemo(
    () => broadcasts.some((b) => b.status === 'sending'),
    [broadcasts],
  );

  useEffect(() => {
    function startPolling() {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(fetchBroadcasts, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }

    // Pause polling while the tab is hidden — keeps Supabase cold when
    // the user is away, and ensures a fresh fetch the moment they
    // refocus so they don't see stale data on return.
    function handleVisibilityChange() {
      if (!anySending) return;
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        fetchBroadcasts();
        startPolling();
      }
    }

    if (anySending && document.visibilityState === 'visible') {
      startPolling();
    } else {
      stopPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [anySending]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top indeterminate progress bar: only visible while a broadcast
          is mid-send. Pure CSS animation so no extra deps. */}
      {anySending && (
        <div
          role="progressbar"
          aria-label={t('broadcastInProgress')}
          className="broadcast-indeterminate fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-muted"
        >
          <div className="broadcast-indeterminate-bar h-0.5 bg-primary" />
          <style jsx>{`
            .broadcast-indeterminate-bar {
              width: 33%;
              transform: translateX(-100%);
              animation: broadcast-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1)
                infinite;
            }
            @keyframes broadcast-slide {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(400%);
              }
            }
          `}</style>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>
        <GatedButton
          data-tour="broadcasts-new"
          canAct={canCreate}
          gateReason="create broadcasts"
          onClick={() => router.push('/broadcasts/new')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t('newBroadcast')}
        </GatedButton>
      </div>

      {/* Fase 5, Etapa 4 — current-state cards, independent of any
          filter/period below. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard title={t('summarySending')} value={String(summary?.sending_count ?? 0)} icon={Send} />
        <MetricCard title={t('summaryScheduled')} value={String(summary?.scheduled_count ?? 0)} icon={CalendarClock} />
        <MetricCard title={t('summaryPaused')} value={String(summary?.paused_count ?? 0)} icon={Pause} />
        <MetricCard
          title={t('summarySentThisMonth')}
          value={String(summary?.sent_this_month_count ?? 0)}
          icon={MessageSquareText}
        />
        <Link href="/settings?tab=optOut" className="block rounded-xl transition-opacity hover:opacity-80">
          <MetricCard
            title={t('summaryBlockedOptOut')}
            value={String(summary?.blocked_phones_count ?? 0)}
            icon={Ban}
            subtitle={t('summaryBlockedOptOutLink')}
          />
        </Link>
      </div>

      {Number.isFinite(maxBroadcastsPerMonth) && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">
              {t('monthlyUsage', { count: broadcastsThisMonth, max: maxBroadcastsPerMonth })}
            </span>
            {broadcastsThisMonth >= maxBroadcastsPerMonth && (
              <span className="text-xs font-medium text-destructive">{t('monthlyLimitReached')}</span>
            )}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-1.5 rounded-full ${
                broadcastsThisMonth >= maxBroadcastsPerMonth ? 'bg-destructive' : 'bg-primary'
              }`}
              style={{
                width: `${Math.min(100, percent(broadcastsThisMonth, maxBroadcastsPerMonth))}%`,
              }}
            />
          </div>
        </div>
      )}

      {broadcasts.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-border bg-card">
          <Radio className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{t('noBroadcastsYet')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('createFirstBroadcastHint')}
          </p>
          <GatedButton
            canAct={canCreate}
            gateReason="create broadcasts"
            onClick={() => router.push('/broadcasts/new')}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('newBroadcast')}
          </GatedButton>
        </div>
      ) : (
        <>
          <BroadcastFilterBar
            filters={filters}
            onChange={setFilters}
            tags={tags}
            channels={channels}
          />
          {filteredBroadcasts.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center rounded-xl border border-border bg-card">
              <p className="text-sm text-muted-foreground">{t('noBroadcastsMatchFilter')}</p>
            </div>
          ) : (
            <div data-tour="broadcasts-list" className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">{t('columnName')}</TableHead>
                    <TableHead className="hidden text-muted-foreground md:table-cell">{t('columnTemplate')}</TableHead>
                    <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
                      {t('columnRecipients')}
                    </TableHead>
                    <TableHead className="hidden text-muted-foreground lg:table-cell">{t('columnDelivery')}</TableHead>
                    <TableHead className="hidden text-muted-foreground lg:table-cell">{t('columnRead')}</TableHead>
                    <TableHead data-tour="broadcasts-status" className="text-muted-foreground">{t('columnStatus')}</TableHead>
                    <TableHead className="hidden text-muted-foreground sm:table-cell">{t('columnDate')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBroadcasts.map((broadcast) => {
                    const status = getBroadcastStatus(broadcast.status);
                    return (
                      <TableRow
                        key={broadcast.id}
                        className="cursor-pointer border-border hover:bg-muted/50"
                        onClick={() => router.push(`/broadcasts/${broadcast.id}`)}
                      >
                        <TableCell className="font-medium text-foreground">
                          {broadcast.name}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {broadcast.template_name}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono text-muted-foreground tabular-nums sm:table-cell">
                          {broadcast.total_recipients}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <RateCell
                            value={broadcast.delivered_count}
                            total={broadcast.total_recipients}
                            color="bg-primary"
                          />
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <RateCell
                            value={broadcast.read_count}
                            total={broadcast.total_recipients}
                            color="bg-blue-500"
                          />
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
                          >
                            {status.pulse && (
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gold" />
                              </span>
                            )}
                            {tStatus(status.labelKey)}
                          </span>
                          {broadcast.status === 'sending' && broadcast.batch_size > 0 && (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {t('batchOf', {
                                current: broadcast.current_batch + 1,
                                total: Math.max(1, Math.ceil(broadcast.total_recipients / broadcast.batch_size)),
                              })}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="hidden font-mono text-muted-foreground sm:table-cell">
                          {new Date(broadcast.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
