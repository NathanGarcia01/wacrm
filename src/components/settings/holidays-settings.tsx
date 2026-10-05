'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarOff, Loader2, Plus, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import type { Holiday } from '@/types';
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

/**
 * Settings → Atendimento → Feriados (migration 069). One-off dates
 * (no yearly recurrence) where business_hours doesn't apply.
 */
export function HolidaysSettings() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan('edit-settings');
  const t = useTranslations('settings.attendance.holidays');

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchHolidays = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase.from('holidays').select('*').order('date');
    setHolidays((data as Holiday[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchHolidays();
    }
  }, [accountId, fetchHolidays]);

  async function handleAdd() {
    const trimmedLabel = label.trim();
    if (!date || !trimmedLabel || !accountId) return;
    setAdding(true);
    const { error } = await supabase
      .from('holidays')
      .insert({ account_id: accountId, date, label: trimmedLabel });
    setAdding(false);
    if (error) {
      toast.error(t('addFailed'));
      return;
    }
    setDate('');
    setLabel('');
    await fetchHolidays();
  }

  async function handleDelete(holiday: Holiday) {
    setBusyId(holiday.id);
    const { error } = await supabase.from('holidays').delete().eq('id', holiday.id);
    setBusyId(null);
    if (error) {
      toast.error(t('deleteFailed'));
      return;
    }
    setHolidays((prev) => prev.filter((h) => h.id !== holiday.id));
  }

  function formatDate(iso: string): string {
    const [year, month, day] = iso.split('-');
    return `${day}/${month}/${year}`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <CalendarOff className="size-4 text-primary" />
          {t('title')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder={t('labelPlaceholder')}
              className="min-w-[180px] flex-1 border-border bg-muted text-foreground"
            />
            <Button
              onClick={handleAdd}
              disabled={adding || !date || !label.trim()}
              className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {adding ? <Loader2 className="size-4 animate-spin" /> : <><Plus className="size-4" />{t('addButton')}</>}
            </Button>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-32 text-muted-foreground">{t('dateColumn')}</TableHead>
                <TableHead className="text-muted-foreground">{t('labelColumn')}</TableHead>
                <TableHead className="w-16 text-muted-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : holidays.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : (
                holidays.map((holiday) => (
                  <TableRow key={holiday.id} className="group border-border">
                    <TableCell className="text-sm text-foreground">{formatDate(holiday.date)}</TableCell>
                    <TableCell className="text-sm text-foreground">{holiday.label}</TableCell>
                    <TableCell>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleDelete(holiday)}
                          disabled={busyId === holiday.id}
                          aria-label={t('deleteAria', { label: holiday.label })}
                          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-destructive disabled:opacity-50"
                        >
                          {busyId === holiday.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {!canEdit && <p className="text-xs text-muted-foreground">{t('adminOnlyHint')}</p>}
      </CardContent>
    </Card>
  );
}
