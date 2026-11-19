'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, ShieldAlert, ShieldCheck, X } from 'lucide-react';

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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * Settings → Vendas → Bloqueio de marketing (opt-out), parte 1 —
 * lista de palavras-chave (accounts.broadcast_optout_keywords,
 * migration 091) e o interruptor de resposta automática
 * (accounts.broadcast_optout_enforced, migration 092).
 *
 * Fase 2 (Radar) — produto: o bloqueio em si (excluir quem pediu pra
 * sair dos disparos) passou a ser SEMPRE aplicado, pra toda conta,
 * sem opção de desligar — ver broadcasts/cron/route.ts,
 * use-broadcast-sending.ts, marketing-template-guard.ts. O
 * interruptor abaixo NÃO controla mais isso; só decide se o cliente
 * recebe uma mensagem confirmando o bloqueio. O nome da coluna no
 * banco ficou desatualizado de propósito (renomear é uma migration
 * separada) — só o texto da tela e os comentários do código foram
 * atualizados aqui.
 *
 * Escrita via rota server-side (/api/settings/opt-out/keywords) em
 * vez do write direto que esta tela fazia antes — só assim uma
 * mudança na lista de keywords pode ser auditada
 * (optout_keywords_audit_log, migration 136; INSERT exige
 * service_role, mesmo padrão de toda tabela de auditoria desta
 * base).
 */
export function OptOutKeywordsSettings() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan('edit-settings');
  const t = useTranslations('settings.optOut.keywords');

  const [keywords, setKeywords] = useState<string[]>([]);
  const [enforced, setEnforced] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from('accounts')
      .select('broadcast_optout_keywords, broadcast_optout_enforced')
      .eq('id', accountId)
      .single();
    setKeywords(data?.broadcast_optout_keywords ?? []);
    setEnforced(data?.broadcast_optout_enforced ?? false);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchData();
    }
  }, [accountId, fetchData]);

  function addKeyword() {
    const trimmed = newKeyword.trim().toLowerCase();
    if (!trimmed || keywords.includes(trimmed)) {
      setNewKeyword('');
      return;
    }
    setKeywords((prev) => [...prev, trimmed]);
    setNewKeyword('');
  }

  function removeKeyword(word: string) {
    setKeywords((prev) => prev.filter((k) => k !== word));
  }

  async function saveKeywords() {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/opt-out/keywords', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords }),
      });
      if (!res.ok) throw new Error();
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  // A lista vazia desativa TODA captura automática por palavra-chave
  // (o bloqueio por botão SAIR/NÃO SOU A PESSOA continua — esse não
  // depende da lista) — pede confirmação explícita antes, em vez de
  // deixar isso acontecer de lado, só por ter apagado a última chip.
  function handleSaveClick() {
    if (keywords.length === 0) {
      setConfirmEmptyOpen(true);
      return;
    }
    saveKeywords();
  }

  async function confirmEmptyAndSave() {
    setConfirmEmptyOpen(false);
    await saveKeywords();
  }

  async function handleToggleEnforced(next: boolean) {
    if (!accountId) return;
    setEnforced(next);
    try {
      const res = await fetch('/api/settings/opt-out/keywords', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enforced: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next ? t('enforcedOn') : t('enforcedOff'));
    } catch {
      setEnforced(!next);
      toast.error(t('enforcedSaveFailed'));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <ShieldAlert className="size-4 text-primary" />
          {t('title')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="text-xs text-foreground">{t('mandatoryBlockingNotice')}</p>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/40 p-4">
              <div>
                <Label className="text-foreground">{t('enforcedLabel')}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('enforcedHint')}</p>
              </div>
              <Switch checked={enforced} disabled={!canEdit} onCheckedChange={handleToggleEnforced} />
            </div>

            <div>
              <Label className="text-foreground">{t('keywordsLabel')}</Label>
              <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{t('keywordsHint')}</p>
              <div className="flex flex-wrap gap-1.5">
                {keywords.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t('keywordsEmpty')}</span>
                ) : (
                  keywords.map((word) => (
                    <span
                      key={word}
                      className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                    >
                      {word}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => removeKeyword(word)}
                          aria-label={t('removeKeywordAria', { word })}
                          className="hover:opacity-70"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>
              {canEdit && (
                <div className="mt-3 flex items-center gap-2">
                  <Input
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addKeyword();
                      }
                    }}
                    placeholder={t('newKeywordPlaceholder')}
                    className="h-9 w-56 bg-muted"
                  />
                  <Button type="button" variant="outline" onClick={addKeyword} className="border-border">
                    {t('addKeywordButton')}
                  </Button>
                </div>
              )}
            </div>

            {canEdit ? (
              <Button
                onClick={handleSaveClick}
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

      <Dialog open={confirmEmptyOpen} onOpenChange={setConfirmEmptyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('confirmEmptyTitle')}</DialogTitle>
            <DialogDescription>{t('confirmEmptyDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmEmptyOpen(false)}>
              {t('confirmEmptyCancel')}
            </Button>
            <Button variant="destructive" onClick={confirmEmptyAndSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : t('confirmEmptyConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
