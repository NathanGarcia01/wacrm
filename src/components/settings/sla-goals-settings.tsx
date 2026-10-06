'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Target } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type DurationUnit = 'min' | 'h';

interface GoalState {
  /** Raw text as typed, in whichever unit is currently selected —
   *  empty string means the goal is disabled (saves as NULL). */
  value: string;
  unit: DurationUnit;
  businessHours: boolean;
}

const EMPTY_GOAL: GoalState = { value: '', unit: 'min', businessHours: false };

/** Minutes stored in the DB → a GoalState for display. Picks "h" as
 *  the starting unit only when the value is a clean multiple of 60
 *  (e.g. 240min shows as "4 h") — anything else starts in minutes so
 *  no precision is silently dropped from the display. */
function fromMinutes(minutes: number | null, businessHours: boolean): GoalState {
  if (minutes == null) return { ...EMPTY_GOAL, businessHours };
  if (minutes >= 60 && minutes % 60 === 0) {
    return { value: String(minutes / 60), unit: 'h', businessHours };
  }
  return { value: String(minutes), unit: 'min', businessHours };
}

/** GoalState → minutes for saving. Null when empty/invalid (= goal
 *  disabled) rather than 0 — a goal is never "respond within 0". */
function toMinutes(goal: GoalState): number | null {
  const raw = Number(goal.value);
  if (goal.value.trim() === '' || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(goal.unit === 'h' ? raw * 60 : raw);
}

function BusinessHoursToggle({
  value,
  onChange,
  disabled,
  labelOff,
  labelOn,
}: {
  value: boolean
  onChange: (v: boolean) => void
  disabled: boolean
  labelOff: string
  labelOn: string
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
      {([false, true] as const).map((mode) => (
        <button
          key={String(mode)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(mode)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            value === mode
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {mode ? labelOn : labelOff}
        </button>
      ))}
    </div>
  );
}

/**
 * Settings → Atendimento → Metas de SLA. Uma meta de 1ª resposta e
 * uma de resolução, cada uma: minutos (campo numérico + seletor
 * min/h, sempre salvo em minutos — migration 080) + modo 24h/horas
 * úteis independente. Vazio = meta desativada (NULL no banco), nunca
 * salva como 0 — ver fromMinutes/toMinutes acima.
 *
 * `accounts_update` (RLS) já exige admin+; `useCan('edit-settings')`
 * é o mesmo gate de BusinessHoursSettings, então a UI nunca promete
 * uma gravação que o banco vai rejeitar.
 */
export function SlaGoalsSettings() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan('edit-settings');
  const t = useTranslations('settings.attendance.slaGoals');

  const [firstResponse, setFirstResponse] = useState<GoalState>(EMPTY_GOAL);
  const [resolution, setResolution] = useState<GoalState>(EMPTY_GOAL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from('accounts')
      .select(
        'sla_first_response_minutes, sla_first_response_business_hours, sla_resolution_minutes, sla_resolution_business_hours',
      )
      .eq('id', accountId)
      .single();

    setFirstResponse(
      fromMinutes(data?.sla_first_response_minutes ?? null, data?.sla_first_response_business_hours ?? false),
    );
    setResolution(
      fromMinutes(data?.sla_resolution_minutes ?? null, data?.sla_resolution_business_hours ?? false),
    );
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
        sla_first_response_minutes: toMinutes(firstResponse),
        sla_first_response_business_hours: firstResponse.businessHours,
        sla_resolution_minutes: toMinutes(resolution),
        sla_resolution_business_hours: resolution.businessHours,
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
            {(
              [
                { key: 'firstResponse' as const, state: firstResponse, setState: setFirstResponse },
                { key: 'resolution' as const, state: resolution, setState: setResolution },
              ]
            ).map(({ key, state, setState }) => (
              <div key={key} className="grid gap-2 border-b border-border pb-4 last:border-0 last:pb-0 sm:grid-cols-[180px_1fr] sm:items-start">
                <div>
                  <Label className="text-foreground">{t(`${key}.label`)}</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t(`${key}.hint`)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    placeholder={t('disabledPlaceholder')}
                    value={state.value}
                    disabled={!canEdit}
                    onChange={(e) => setState((prev) => ({ ...prev, value: e.target.value }))}
                    className="w-28 bg-muted"
                  />
                  <Select
                    value={state.unit}
                    disabled={!canEdit}
                    onValueChange={(v) => v && setState((prev) => ({ ...prev, unit: v as DurationUnit }))}
                  >
                    <SelectTrigger className="w-24 bg-muted">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="min">{t('unitMinutes')}</SelectItem>
                      <SelectItem value="h">{t('unitHours')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <BusinessHoursToggle
                    value={state.businessHours}
                    disabled={!canEdit}
                    onChange={(v) => setState((prev) => ({ ...prev, businessHours: v }))}
                    labelOff={t('businessHoursOff')}
                    labelOn={t('businessHoursOn')}
                  />
                </div>
              </div>
            ))}

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
