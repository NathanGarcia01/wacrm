'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, Loader2, Users } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { accountCurrentMonthKey, previousMonthKey } from '@/lib/reports/sales-goals';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AccountMember } from '@/types';

interface GoalRow {
  valueGoal: string;
  countGoal: string;
}

function toNumberOrNull(raw: string): number | null {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Account-local month name ("outubro de 2026") for the card
 *  header — same `Intl.DateTimeFormat` + account-timezone technique
 *  used by sales-goals.ts's accountCurrentMonthKey, just formatted
 *  for display instead of as a DB key. */
function monthLabel(monthKey: string, locale: string): string {
  // monthKey is always YYYY-MM-01 (UTC date-only) — build the Date
  // from UTC parts so no local-timezone shift can roll it into the
  // adjacent month when formatting.
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1, 12));
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/**
 * Settings → Vendas → Meta de vendas (por usuário). Uma linha por
 * membro da conta, meta do mês corrente (valor e/ou quantidade) —
 * `account_user_sales_goals`, migration 087. "Copiar metas do mês
 * anterior" sobrescreve as metas do mês corrente com as do mês
 * anterior, linha a linha, só pros usuários que tinham meta lá.
 */
export function UserSalesGoalsSettings() {
  const supabase = createClient();
  const { accountId, account } = useAuth();
  const canEdit = useCan('edit-settings');
  const t = useTranslations('settings.salesGoals.perUser');
  const locale = useLocale();
  const timezone = account?.timezone ?? 'America/Sao_Paulo';

  const monthKey = useMemo(() => accountCurrentMonthKey(timezone), [timezone]);
  const prevMonthKey = useMemo(() => previousMonthKey(monthKey), [monthKey]);

  const [members, setMembers] = useState<AccountMember[]>([]);
  const [goals, setGoals] = useState<Record<string, GoalRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [membersRes, goalsRes] = await Promise.all([
      fetch('/api/account/members', { cache: 'no-store' }),
      supabase
        .from('account_user_sales_goals')
        .select('user_id, value_goal, count_goal')
        .eq('account_id', accountId)
        .eq('month', monthKey),
    ]);

    if (membersRes.ok) {
      const data = (await membersRes.json()) as { members: AccountMember[] };
      setMembers(data.members);
    }

    const byUser: Record<string, GoalRow> = {};
    for (const row of goalsRes.data ?? []) {
      byUser[row.user_id] = {
        valueGoal: row.value_goal != null ? String(row.value_goal) : '',
        countGoal: row.count_goal != null ? String(row.count_goal) : '',
      };
    }
    setGoals(byUser);
    setLoading(false);
  }, [supabase, accountId, monthKey]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchData();
    }
  }, [accountId, fetchData]);

  function rowOf(userId: string): GoalRow {
    return goals[userId] ?? { valueGoal: '', countGoal: '' };
  }

  function setRow(userId: string, patch: Partial<GoalRow>) {
    setGoals((prev) => ({ ...prev, [userId]: { ...rowOf(userId), ...patch } }));
  }

  async function handleSaveRow(userId: string) {
    if (!accountId) return;
    const row = rowOf(userId);
    const valueGoal = toNumberOrNull(row.valueGoal);
    const countGoal = toNumberOrNull(row.countGoal);
    setSaving(userId);
    const { error } =
      valueGoal == null && countGoal == null
        ? await supabase
            .from('account_user_sales_goals')
            .delete()
            .eq('account_id', accountId)
            .eq('user_id', userId)
            .eq('month', monthKey)
        : await supabase.from('account_user_sales_goals').upsert({
            account_id: accountId,
            user_id: userId,
            month: monthKey,
            value_goal: valueGoal,
            count_goal: countGoal,
          });
    setSaving(null);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    toast.success(t('saved'));
  }

  async function handleCopyPreviousMonth() {
    if (!accountId) return;
    setCopying(true);
    const { data: prevRows, error: fetchError } = await supabase
      .from('account_user_sales_goals')
      .select('user_id, value_goal, count_goal')
      .eq('account_id', accountId)
      .eq('month', prevMonthKey);

    if (fetchError || !prevRows || prevRows.length === 0) {
      setCopying(false);
      toast.error(t('copyEmpty'));
      return;
    }

    const { error } = await supabase.from('account_user_sales_goals').upsert(
      prevRows.map((r) => ({
        account_id: accountId,
        user_id: r.user_id,
        month: monthKey,
        value_goal: r.value_goal,
        count_goal: r.count_goal,
      })),
    );
    setCopying(false);
    if (error) {
      toast.error(t('copyFailed'));
      return;
    }
    toast.success(t('copySuccess', { count: prevRows.length }));
    await fetchData();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Users className="size-4 text-primary" />
            {t('title', { month: monthLabel(monthKey, locale) })}
          </CardTitle>
          <CardDescription className="text-muted-foreground">{t('description')}</CardDescription>
        </div>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyPreviousMonth}
            disabled={copying || loading}
            className="shrink-0 border-border text-muted-foreground hover:bg-muted"
          >
            {copying ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
            {t('copyButton')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : members.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => {
              const row = rowOf(m.user_id);
              const isBusy = saving === m.user_id;
              return (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-[160px] flex-1 truncate text-sm font-medium text-foreground">
                    {m.full_name || m.email || t('unnamedMember')}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    placeholder={t('valueGoalPlaceholder')}
                    value={row.valueGoal}
                    disabled={!canEdit}
                    onChange={(e) => setRow(m.user_id, { valueGoal: e.target.value })}
                    className="w-32 bg-muted"
                  />
                  <Input
                    type="number"
                    min={1}
                    placeholder={t('countGoalPlaceholder')}
                    value={row.countGoal}
                    disabled={!canEdit}
                    onChange={(e) => setRow(m.user_id, { countGoal: e.target.value })}
                    className="w-28 bg-muted"
                  />
                  {canEdit && (
                    <Button
                      size="sm"
                      onClick={() => handleSaveRow(m.user_id)}
                      disabled={isBusy}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {isBusy ? <Loader2 className="size-4 animate-spin" /> : t('saveButton')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
