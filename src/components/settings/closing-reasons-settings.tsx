'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Lock, Loader2, Pencil, Plus, Trash2, Tag } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import type { ClosingReason } from '@/types';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Settings → Atendimento → Motivos de Fechamento (migration 069).
 * `is_system` rows (seeded by handle_new_user — migrations 069/071)
 * are rendered read-only: `closing_reasons` RLS already rejects
 * update/delete on them for everyone including admins (migration
 * 069's `and not is_system` clause), so hiding the controls here is
 * UX, not the actual guard.
 */
export function ClosingReasonsSettings() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan('edit-settings');
  const t = useTranslations('settings.attendance.closingReasons');
  const tCommon = useTranslations('common');

  const [reasons, setReasons] = useState<ClosingReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClosingReason | null>(null);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchReasons = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from('closing_reasons')
      .select('*')
      .order('position')
      .order('created_at');
    setReasons((data as ClosingReason[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchReasons();
    }
  }, [accountId, fetchReasons]);

  function openCreate() {
    setEditing(null);
    setLabel('');
    setDialogOpen(true);
  }

  function openEdit(reason: ClosingReason) {
    setEditing(reason);
    setLabel(reason.label);
    setDialogOpen(true);
  }

  async function handleSave() {
    const trimmed = label.trim();
    if (!trimmed || !accountId) return;
    setSaving(true);

    const { error } = editing
      ? await supabase.from('closing_reasons').update({ label: trimmed }).eq('id', editing.id)
      : await supabase.from('closing_reasons').insert({
          account_id: accountId,
          label: trimmed,
          position: reasons.length,
        });

    setSaving(false);
    if (error) {
      toast.error(editing ? t('saveFailed') : t('createFailed'));
      return;
    }
    toast.success(editing ? t('saved') : t('created'));
    setDialogOpen(false);
    await fetchReasons();
  }

  async function handleDelete(reason: ClosingReason) {
    if (!window.confirm(t('deleteConfirm', { label: reason.label }))) return;
    setBusyId(reason.id);
    const { error } = await supabase.from('closing_reasons').delete().eq('id', reason.id);
    setBusyId(null);
    if (error) {
      toast.error(t('deleteFailed'));
      return;
    }
    toast.success(t('deleted'));
    setReasons((prev) => prev.filter((r) => r.id !== reason.id));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Tag className="size-4 text-primary" />
          {t('title')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit && (
          <div className="flex justify-end">
            <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="size-4" />
              {t('newReason')}
            </Button>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">{t('labelColumn')}</TableHead>
                <TableHead className="w-24 text-muted-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : reasons.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : (
                reasons.map((reason) => (
                  <TableRow key={reason.id} className="group border-border">
                    <TableCell className="text-sm font-medium text-foreground">
                      <span className="flex items-center gap-2">
                        {reason.label}
                        {reason.is_system && (
                          <Badge variant="outline" className="gap-1 text-[10px] font-normal text-muted-foreground">
                            <Lock className="size-2.5" />
                            {t('systemBadge')}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      {canEdit && !reason.is_system && (
                        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => openEdit(reason)}
                            aria-label={t('editAria', { label: reason.label })}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(reason)}
                            disabled={busyId === reason.id}
                            aria-label={t('deleteAria', { label: reason.label })}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                          >
                            {busyId === reason.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                          </button>
                        </div>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editing ? t('editTitle') : t('newTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('labelColumn')}</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('labelPlaceholder')}
              className="border-border bg-muted text-foreground"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || !label.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : editing ? tCommon('save') : tCommon('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
