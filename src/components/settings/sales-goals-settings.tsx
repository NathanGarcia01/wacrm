'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Target } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

/** Empty string = goal disabled (saves as NULL), never 0 — same
 *  convention as sla-goals-settings.tsx. */
function toNumberOrNull(raw: string): number | null {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Settings → Vendas → Meta de vendas (conta). Meta mensal da conta
 * em valor e/ou quantidade — migration 087. Vazio = meta desativada.
 * Independe do mês: a meta é um valor fixo por conta, o mês corrente
 * é calculado pelas RPCs (get_pipeline_dashboard/get_user_summary_dashboard)
 * no fuso da conta.
 */
export function SalesGoalsSettings() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan('edit-settings');
  const t = useTranslations('settings.salesGoals.account');

  const [valueGoal, setValueGoal] = useState('');
  const [countGoal, setCountGoal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from('accounts')
      .select('sales_goal_value, sales_goal_count')
      .eq('id', accountId)
      .single();

    setValueGoal(data?.sales_goal_value != null ? String(data.sales_goal_value) : '');
    setCountGoal(data?.sales_goal_count != null ? String(data.sales_goal_count) : '');
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchData();
    }
  }, [accountId, fetchData]);

  async function handleSave() {
    if (!accountId) return;
    setSaving(true);
    const { error } = await supabase
      .from('accounts')
      .update({
        sales_goal_value: toNumberOrNull(valueGoal),
        sales_goal_count: toNumberOrNull(countGoal),
      })
      .eq('id', accountId);
    setSaving(false);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    toast.success(t('saved'));
    await fetchData();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Target className="size-4 text-primary" />
          {t('title')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid gap-2 border-b border-border pb-4 sm:grid-cols-[180px_1fr] sm:items-start">
              <div>
                <Label className="text-foreground">{t('valueGoal.label')}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('valueGoal.hint')}</p>
              </div>
              <Input
                type="number"
                min={1}
                placeholder={t('disabledPlaceholder')}
                value={valueGoal}
                disabled={!canEdit}
                onChange={(e) => setValueGoal(e.target.value)}
                className="w-40 bg-muted"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-start">
              <div>
                <Label className="text-foreground">{t('countGoal.label')}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('countGoal.hint')}</p>
              </div>
              <Input
                type="number"
                min={1}
                placeholder={t('disabledPlaceholder')}
                value={countGoal}
                disabled={!canEdit}
                onChange={(e) => setCountGoal(e.target.value)}
                className="w-40 bg-muted"
              />
            </div>

            {canEdit ? (
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : t('saveButton')}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">{t('adminOnlyHint')}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
