'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Ban, Download, Loader2, Plus, Upload } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { parseCsvGeneric } from '@/lib/contacts/parse-csv-generic';
import { exportBlockedPhonesToCsv } from '@/lib/whatsapp/export-blocked-phones-csv';
import type { AccountMember, BlockedPhone, BlockedPhoneSource } from '@/types';
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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

const PHONE_HEADER_ALIASES = ['phone', 'telefone', 'celular', 'whatsapp', 'numero', 'número'];
const REASON_HEADER_ALIASES = ['reason', 'motivo', 'observacao', 'observação', 'obs'];

function normalizeHeader(h: string): string {
  return h.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/**
 * Settings → Vendas → Bloqueio de marketing (opt-out), parte 2 —
 * lista de telefones bloqueados (blocked_phones, migration 091).
 * Bloquear/desbloquear manual com motivo, import/export CSV.
 *
 * Mostra só bloqueios ATIVOS por padrão (unblocked_at IS NULL) — o
 * toggle "mostrar histórico" inclui os já desbloqueados, já que a
 * tabela nunca apaga linha (histórico append-only).
 */
export function BlockedPhonesSettings() {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const canEdit = useCan('edit-settings');
  const t = useTranslations('settings.optOut.blockedPhones');
  const tCommon = useTranslations('common');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<BlockedPhone[]>([]);
  const [memberNames, setMemberNames] = useState<Map<string, string>>(new Map());
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newReason, setNewReason] = useState('');
  const [blocking, setBlocking] = useState(false);

  const [unblockTarget, setUnblockTarget] = useState<BlockedPhone | null>(null);
  const [unblockReason, setUnblockReason] = useState('');
  const [unblocking, setUnblocking] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [rowsRes, membersRes] = await Promise.all([
      (() => {
        let q = supabase.from('blocked_phones').select('*').order('blocked_at', { ascending: false });
        if (!showHistory) q = q.is('unblocked_at', null);
        return q;
      })(),
      fetch('/api/account/members', { cache: 'no-store' }),
    ]);
    setRows((rowsRes.data as BlockedPhone[] | null) ?? []);
    if (membersRes.ok) {
      const data = (await membersRes.json()) as { members: AccountMember[] };
      setMemberNames(new Map(data.members.map((m) => [m.user_id, m.full_name || m.email || ''])));
    }
    setLoading(false);
  }, [supabase, accountId, showHistory]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchData();
    }
  }, [accountId, fetchData]);

  async function handleBlock() {
    const phone = newPhone.trim();
    if (!phone || !accountId) return;
    setBlocking(true);
    const { error } = await supabase.from('blocked_phones').insert({
      account_id: accountId,
      phone,
      source: 'manual',
      reason: newReason.trim() || null,
      blocked_by: user?.id ?? null,
    });
    setBlocking(false);
    if (error) {
      // 23505 = already actively blocked (unique partial index, migration 091)
      toast.error(error.code === '23505' ? t('alreadyBlocked') : t('blockFailed'));
      return;
    }
    toast.success(t('blocked'));
    setBlockDialogOpen(false);
    setNewPhone('');
    setNewReason('');
    await fetchData();
  }

  async function handleUnblock() {
    if (!unblockTarget) return;
    setUnblocking(true);
    const { error } = await supabase
      .from('blocked_phones')
      .update({
        unblocked_at: new Date().toISOString(),
        unblocked_by: user?.id ?? null,
        unblock_reason: unblockReason.trim() || null,
      })
      .eq('id', unblockTarget.id);
    setUnblocking(false);
    if (error) {
      toast.error(t('unblockFailed'));
      return;
    }
    toast.success(t('unblocked'));
    setUnblockTarget(null);
    setUnblockReason('');
    await fetchData();
  }

  async function handleImportFile(file: File) {
    if (!accountId) return;
    const text = await file.text();
    const { headers, rows: csvRows } = parseCsvGeneric(text);
    const normalizedHeaders = headers.map(normalizeHeader);
    const phoneIdx = normalizedHeaders.findIndex((h) => PHONE_HEADER_ALIASES.includes(h));
    if (phoneIdx === -1) {
      toast.error(t('importNoPhoneColumn'));
      return;
    }
    const reasonIdx = normalizedHeaders.findIndex((h) => REASON_HEADER_ALIASES.includes(h));

    const payload = csvRows
      .map((row) => ({
        account_id: accountId,
        phone: row[phoneIdx]?.trim() ?? '',
        source: 'import' as BlockedPhoneSource,
        reason: reasonIdx >= 0 ? row[reasonIdx]?.trim() || null : null,
      }))
      .filter((r) => r.phone.length > 0);

    if (payload.length === 0) {
      toast.error(t('importEmpty'));
      return;
    }

    setImporting(true);
    // Idempotent per-row: a phone already actively blocked (unique
    // partial index, migration 091) just no-ops for that row — insert
    // the rest, surface only the count that actually landed.
    let imported = 0;
    for (const row of payload) {
      const { error } = await supabase.from('blocked_phones').insert(row);
      if (!error) imported += 1;
    }
    setImporting(false);
    toast.success(t('importSuccess', { count: imported, total: payload.length }));
    await fetchData();
  }

  function handleExport() {
    exportBlockedPhonesToCsv(rows, memberNames, t);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Ban className="size-4 text-primary" />
            {t('title')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">{t('description')}</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} className="border-border">
            <Download className="size-4" />
            {t('exportButton')}
          </Button>
          {canEdit && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImportFile(file);
                  e.target.value = '';
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                className="border-border"
              >
                {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {t('importButton')}
              </Button>
              <Button size="sm" onClick={() => setBlockDialogOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="size-4" />
                {t('blockButton')}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch checked={showHistory} onCheckedChange={(v) => setShowHistory(!!v)} />
          <Label className="text-sm text-muted-foreground">{t('showHistoryLabel')}</Label>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">{t('colPhone')}</TableHead>
                <TableHead className="text-muted-foreground">{t('colSource')}</TableHead>
                <TableHead className="text-muted-foreground">{t('colReason')}</TableHead>
                <TableHead className="text-muted-foreground">{t('colBlockedAt')}</TableHead>
                <TableHead className="w-24 text-muted-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} className="border-border">
                    <TableCell className="font-mono text-sm text-foreground">{row.phone}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t(`sourceLabels.${row.source}`)}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-sm text-muted-foreground" title={row.reason ?? undefined}>
                      {row.reason ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(row.blocked_at).toLocaleDateString()}
                      {row.unblocked_at && (
                        <span className="ml-1.5 text-xs text-muted-foreground/70">{t('unblockedBadge')}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canEdit && !row.unblocked_at && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setUnblockTarget(row)}
                          className="border-border text-muted-foreground hover:bg-muted"
                        >
                          {t('unblockButton')}
                        </Button>
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

      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('blockDialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('colPhone')}</Label>
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder={t('phonePlaceholder')}
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('colReason')}</Label>
              <Textarea
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder={t('reasonPlaceholder')}
                className="border-border bg-muted text-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBlockDialogOpen(false)}
              disabled={blocking}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {tCommon('cancel')}
            </Button>
            <Button type="button" onClick={handleBlock} disabled={blocking || !newPhone.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {blocking ? <Loader2 className="size-4 animate-spin" /> : t('blockButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unblockTarget !== null} onOpenChange={(open) => !open && setUnblockTarget(null)}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('unblockDialogTitle', { phone: unblockTarget?.phone ?? '' })}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('colReason')}</Label>
            <Textarea
              value={unblockReason}
              onChange={(e) => setUnblockReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              className="border-border bg-muted text-foreground"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setUnblockTarget(null)}
              disabled={unblocking}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {tCommon('cancel')}
            </Button>
            <Button type="button" onClick={handleUnblock} disabled={unblocking} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {unblocking ? <Loader2 className="size-4 animate-spin" /> : t('unblockButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
