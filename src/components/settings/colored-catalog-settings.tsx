'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Trash2, type LucideIcon } from 'lucide-react';

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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SWATCH_COLORS = [
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
];

interface CatalogRow {
  id: string;
  label: string;
  color: string;
  position: number;
}

function ColorSwatch({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="size-5 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: value }}
        aria-label={ariaLabel}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-7 left-0 z-20 flex w-36 flex-wrap gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg">
            {SWATCH_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className="size-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{ backgroundColor: c, borderColor: c === value ? 'var(--foreground)' : 'transparent' }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Generic account-scoped "label + color" catalog manager — same shape
 * for `contact_statuses` and `lead_origins` (migration 086), same shell
 * (Card + Table + Dialog) as `closing-reasons-settings.tsx`, plus a
 * color swatch picker reused from `pipeline-settings.tsx`'s stage
 * editor. No drag-and-drop reorder (new rows just append at the end,
 * same "position = rows.length" convention already used by
 * `deals-settings.tsx`'s loss-reason chips) — a short list doesn't need
 * `@dnd-kit` pulled in a third time.
 *
 * Delete has no "in use" guard: unlike `deal_loss_reasons`
 * (ON DELETE RESTRICT — a historical event can't lose its reason),
 * both FKs here are `ON DELETE SET NULL` (migration 086) — a status/
 * origin is a label for *now*, so removing one in use just clears it
 * from those contacts.
 */
export function ColoredCatalogSettings({
  table,
  icon: Icon,
  translationNamespace,
}: {
  table: 'contact_statuses' | 'lead_origins';
  icon: LucideIcon;
  translationNamespace: 'settings.contactStatuses' | 'settings.leadOrigins';
}) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan('edit-settings');
  const t = useTranslations(translationNamespace);
  const tCommon = useTranslations('common');

  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogRow | null>(null);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(SWATCH_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase.from(table).select('id, label, color, position').order('position').order('created_at');
    setRows((data as CatalogRow[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId, table]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchRows();
    }
  }, [accountId, fetchRows]);

  function openCreate() {
    setEditing(null);
    setLabel('');
    setColor(SWATCH_COLORS[0]);
    setDialogOpen(true);
  }

  function openEdit(row: CatalogRow) {
    setEditing(row);
    setLabel(row.label);
    setColor(row.color);
    setDialogOpen(true);
  }

  async function handleSave() {
    const trimmed = label.trim();
    if (!trimmed || !accountId) return;
    setSaving(true);

    const { error } = editing
      ? await supabase.from(table).update({ label: trimmed, color }).eq('id', editing.id)
      : await supabase.from(table).insert({ account_id: accountId, label: trimmed, color, position: rows.length });

    setSaving(false);
    if (error) {
      toast.error(editing ? t('saveFailed') : t('createFailed'));
      return;
    }
    toast.success(editing ? t('saved') : t('created'));
    setDialogOpen(false);
    await fetchRows();
  }

  async function handleDelete(row: CatalogRow) {
    if (!window.confirm(t('deleteConfirm', { label: row.label }))) return;
    setBusyId(row.id);
    const { error } = await supabase.from(table).delete().eq('id', row.id);
    setBusyId(null);
    if (error) {
      toast.error(t('deleteFailed'));
      return;
    }
    toast.success(t('deleted'));
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Icon className="size-4 text-primary" />
            {t('title')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEdit && (
            <div className="flex justify-end">
              <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="size-4" />
                {t('newItem')}
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
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                      {t('empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id} className="group border-border">
                      <TableCell className="text-sm font-medium text-foreground">
                        <span className="flex items-center gap-2">
                          <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                          {row.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        {canEdit && (
                          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => openEdit(row)}
                              aria-label={t('editAria', { label: row.label })}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(row)}
                              disabled={busyId === row.id}
                              aria-label={t('deleteAria', { label: row.label })}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                            >
                              {busyId === row.id ? (
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
              <DialogTitle className="text-popover-foreground">{editing ? t('editTitle') : t('newTitle')}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('labelColumn')}</Label>
              <div className="flex items-center gap-2">
                <ColorSwatch value={color} onChange={setColor} ariaLabel={t('changeColorAria')} />
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t('labelPlaceholder')}
                  className="border-border bg-muted text-foreground"
                />
              </div>
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
    </>
  );
}
