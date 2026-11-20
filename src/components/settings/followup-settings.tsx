'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Lock, Repeat } from 'lucide-react';

import { useCan } from '@/hooks/use-can';
import { usePlanFeatures } from '@/hooks/use-feature-gate';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const AUDIT_PAGE_SIZE = 50;

interface AuditRow {
  id: string;
  conversation_id: string;
  contact_id: string;
  automation_id: string | null;
  flow_id: string | null;
  outcome: 'sent' | 'skipped';
  reason: string | null;
  mode: 'live' | 'dry_run';
  created_at: string;
}

/**
 * Settings → Atendimento → Follow-up de inatividade (Fase 2, B3).
 * Dois blocos: teto diário (followup_settings.max_per_day, qualquer
 * membro vê, só admin+ edita) e auditoria paginada de
 * followup_dispatch_log (admin+ apenas) — mesmo padrão de
 * RoutingSettings (config + audit na mesma tela) e da paginação de
 * RadarTable (limit/offset, "carregar mais").
 */
export function FollowupSettings() {
  const t = useTranslations('settings.followup');
  const router = useRouter();
  const canEdit = useCan('edit-settings');
  const isAdminPlus = useCan('manage-members');
  const { hasFollowup } = usePlanFeatures();

  const [loading, setLoading] = useState(true);
  const [maxPerDay, setMaxPerDay] = useState<number>(50);
  const [savingMaxPerDay, setSavingMaxPerDay] = useState(false);

  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [modeFilter, setModeFilter] = useState<'all' | 'live' | 'dry_run'>('all');
  const [conversationFilter, setConversationFilter] = useState('');

  useEffect(() => {
    fetch('/api/settings/followup')
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => setMaxPerDay(data.maxPerDay ?? 50))
      .catch(() => toast.error(t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  const buildAuditUrl = useCallback(
    (offset: number) => {
      const params = new URLSearchParams();
      if (modeFilter !== 'all') params.set('mode', modeFilter);
      if (conversationFilter.trim()) params.set('conversationId', conversationFilter.trim());
      params.set('limit', String(AUDIT_PAGE_SIZE));
      params.set('offset', String(offset));
      return `/api/settings/followup/audit?${params.toString()}`;
    },
    [modeFilter, conversationFilter],
  );

  const loadAudit = useCallback(async () => {
    if (!isAdminPlus || !hasFollowup) return;
    setAuditLoading(true);
    try {
      const res = await fetch(buildAuditUrl(0));
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAuditRows(data.rows ?? []);
      setAuditHasMore(!!data.hasMore);
    } catch {
      toast.error(t('auditLoadFailed'));
    } finally {
      setAuditLoading(false);
    }
  }, [isAdminPlus, hasFollowup, buildAuditUrl, t]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  async function loadMoreAudit() {
    setAuditLoadingMore(true);
    try {
      const res = await fetch(buildAuditUrl(auditRows.length));
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAuditRows((prev) => [...prev, ...(data.rows ?? [])]);
      setAuditHasMore(!!data.hasMore);
    } catch {
      toast.error(t('auditLoadFailed'));
    } finally {
      setAuditLoadingMore(false);
    }
  }

  async function handleMaxPerDayChange(next: number) {
    setSavingMaxPerDay(true);
    try {
      const res = await fetch('/api/settings/followup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPerDay: next }),
      });
      if (!res.ok) throw new Error();
      setMaxPerDay(next);
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSavingMaxPerDay(false);
    }
  }

  function reasonLabel(reason: string | null): string {
    switch (reason) {
      case 'opted_out':
        return t('reasonOptedOut');
      case 'outside_session_window':
        return t('reasonOutsideSessionWindow');
      case 'customer_replied':
        return t('reasonCustomerReplied');
      case 'max_attempts_reached':
        return t('reasonMaxAttemptsReached');
      case 'daily_cap_reached':
        return t('reasonDailyCapReached');
      case 'outside_business_hours':
        return t('reasonOutsideBusinessHours');
      default:
        return reason ?? '—';
    }
  }

  if (!hasFollowup) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Repeat className="size-4" />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-10 text-center">
            <Lock className="size-6 text-muted-foreground" />
            <p className="font-medium text-foreground">{t('upsellTitle')}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t('upsellDescription')}</p>
            <Button onClick={() => router.push('/settings?tab=overview')}>{t('upsellButton')}</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Repeat className="size-4" />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">{t('maxPerDayTitle')}</p>
            <p className="mb-3 text-sm text-muted-foreground">{t('maxPerDayDescription')}</p>
            <Input
              type="number"
              min={1}
              value={maxPerDay}
              disabled={!canEdit || savingMaxPerDay}
              className="w-full sm:w-40"
              onChange={(e) => {
                const value = Number(e.target.value);
                if (!Number.isInteger(value) || value < 1) return;
                setMaxPerDay(value);
              }}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (Number.isInteger(value) && value >= 1) handleMaxPerDayChange(value);
              }}
            />
          </div>
          {!canEdit ? <p className="text-xs text-muted-foreground">{t('adminOnlyHint')}</p> : null}
        </CardContent>
      </Card>

      {isAdminPlus ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('auditTitle')}</CardTitle>
            <CardDescription>{t('auditDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t('modeFilterLabel')}</span>
                <Select value={modeFilter} onValueChange={(v) => setModeFilter((v as typeof modeFilter) ?? 'all')}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('modeAll')}</SelectItem>
                    <SelectItem value="live">{t('modeLive')}</SelectItem>
                    <SelectItem value="dry_run">{t('modeDryRun')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t('conversationFilterLabel')}</span>
                <Input
                  placeholder={t('conversationFilterPlaceholder')}
                  value={conversationFilter}
                  onChange={(e) => setConversationFilter(e.target.value)}
                  className="w-56"
                />
              </div>
            </div>

            {auditLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : auditRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('auditEmpty')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('auditConversationColumn')}</TableHead>
                    <TableHead>{t('auditOutcomeColumn')}</TableHead>
                    <TableHead>{t('auditReasonColumn')}</TableHead>
                    <TableHead>{t('auditModeColumn')}</TableHead>
                    <TableHead>{t('auditWhenColumn')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditRows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/inbox?c=${row.conversation_id}`)}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.conversation_id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.outcome === 'sent' ? 'secondary' : 'outline'}>
                          {row.outcome === 'sent' ? t('outcomeSent') : t('outcomeSkipped')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{reasonLabel(row.reason)}</TableCell>
                      <TableCell>
                        <Badge variant={row.mode === 'live' ? 'default' : 'secondary'}>
                          {row.mode === 'live' ? t('modeLive') : t('modeDryRun')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(row.created_at).toLocaleString('pt-BR')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {auditHasMore && !auditLoading ? (
              <div className="flex justify-center">
                <Button variant="outline" onClick={loadMoreAudit} disabled={auditLoadingMore}>
                  {auditLoadingMore ? <Loader2 className="size-4 animate-spin" /> : t('auditLoadMore')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
