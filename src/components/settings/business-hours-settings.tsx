'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Clock, Loader2, Plus, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { DEFAULT_TIMEZONE, TIMEZONES } from '@/lib/timezones';
import type { BusinessHour } from '@/types';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** JS `Date#getDay()` order — 0 = Sunday. */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

interface Window {
  start_time: string;
  end_time: string;
}

/**
 * Settings → Atendimento → Horário de Atendimento (migration 069).
 * One free-form list of windows per weekday (e.g. 08:00–12:00 and
 * 13:00–18:00 for a lunch break) plus the account's timezone, which
 * is what turns these wall-clock windows into real instants
 * elsewhere (business_hours stores `time`, not `timestamptz`).
 *
 * Saves as a single "replace everything" write — delete every
 * business_hours row for the account, re-insert the current state —
 * rather than diffing row by row. Row count is tiny (at most a
 * handful of windows per weekday), so the simplicity is worth it.
 */
export function BusinessHoursSettings() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan('edit-settings');
  const t = useTranslations('settings.attendance.businessHours');
  const weekdayLabel = useTranslations('common.weekdays');

  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [schedule, setSchedule] = useState<Record<number, Window[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [accountRes, hoursRes] = await Promise.all([
      supabase.from('accounts').select('timezone').eq('id', accountId).single(),
      supabase
        .from('business_hours')
        .select('*')
        .order('weekday')
        .order('start_time'),
    ]);

    setTimezone((accountRes.data?.timezone as string | undefined) ?? DEFAULT_TIMEZONE);

    const grouped: Record<number, Window[]> = {};
    for (const day of WEEKDAYS) grouped[day] = [];
    for (const row of (hoursRes.data as BusinessHour[] | null) ?? []) {
      grouped[row.weekday]?.push({ start_time: row.start_time.slice(0, 5), end_time: row.end_time.slice(0, 5) });
    }
    setSchedule(grouped);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchData();
    }
  }, [accountId, fetchData]);

  function addWindow(weekday: number) {
    setSchedule((prev) => ({
      ...prev,
      [weekday]: [...(prev[weekday] ?? []), { start_time: '08:00', end_time: '18:00' }],
    }));
  }

  function removeWindow(weekday: number, index: number) {
    setSchedule((prev) => ({
      ...prev,
      [weekday]: (prev[weekday] ?? []).filter((_, i) => i !== index),
    }));
  }

  function updateWindow(weekday: number, index: number, field: keyof Window, value: string) {
    setSchedule((prev) => ({
      ...prev,
      [weekday]: (prev[weekday] ?? []).map((w, i) => (i === index ? { ...w, [field]: value } : w)),
    }));
  }

  async function handleSave() {
    if (!accountId) return;
    setSaving(true);

    const rows = WEEKDAYS.flatMap((weekday) =>
      (schedule[weekday] ?? [])
        .filter((w) => w.start_time && w.end_time && w.end_time > w.start_time)
        .map((w) => ({ account_id: accountId, weekday, start_time: w.start_time, end_time: w.end_time })),
    );

    const [{ error: tzError }, { error: deleteError }] = await Promise.all([
      supabase.from('accounts').update({ timezone }).eq('id', accountId),
      supabase.from('business_hours').delete().eq('account_id', accountId),
    ]);
    const { error: insertError } = rows.length
      ? await supabase.from('business_hours').insert(rows)
      : { error: null };

    setSaving(false);
    if (tzError || deleteError || insertError) {
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
          <Clock className="size-4 text-primary" />
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
            <div className="grid gap-2 sm:max-w-xs">
              <Label className="text-muted-foreground">{t('timezoneLabel')}</Label>
              <Select value={timezone} onValueChange={(v) => v && setTimezone(v)} disabled={!canEdit}>
                <SelectTrigger className="border-border bg-muted text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-start">
                  <div className="pt-1.5 text-sm font-medium text-foreground">{weekdayLabel(String(weekday))}</div>
                  <div className="space-y-1.5">
                    {(schedule[weekday] ?? []).length === 0 && (
                      <p className="py-1.5 text-sm text-muted-foreground">{t('closed')}</p>
                    )}
                    {(schedule[weekday] ?? []).map((w, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="time"
                          value={w.start_time}
                          disabled={!canEdit}
                          onChange={(e) => updateWindow(weekday, index, 'start_time', e.target.value)}
                          className="h-9 rounded-lg border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
                        />
                        <span className="text-muted-foreground">–</span>
                        <input
                          type="time"
                          value={w.end_time}
                          disabled={!canEdit}
                          onChange={(e) => updateWindow(weekday, index, 'end_time', e.target.value)}
                          className="h-9 rounded-lg border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
                        />
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => removeWindow(weekday, index)}
                            aria-label={t('removeWindowAria')}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => addWindow(weekday)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <Plus className="size-3" />
                        {t('addWindow')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
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
