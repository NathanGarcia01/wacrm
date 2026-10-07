'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, ShieldAlert, X } from 'lucide-react';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * Settings → Vendas → Bloqueio de marketing (opt-out), parte 1 —
 * lista de palavras-chave (accounts.broadcast_optout_keywords,
 * migration 091) e o interruptor de aplicação no envio
 * (accounts.broadcast_optout_enforced, migration 092).
 *
 * Captura (gravar o bloqueio) já roda sempre, pra todas as contas,
 * desde a Etapa 1 — o que esse interruptor liga é (a) a resposta de
 * confirmação/VOLTAR ao bloquear por palavra-chave, e (b), numa etapa
 * futura, a exclusão de bloqueados nos disparos.
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

  async function handleSaveKeywords() {
    if (!accountId) return;
    setSaving(true);
    const { error } = await supabase
      .from('accounts')
      .update({ broadcast_optout_keywords: keywords })
      .eq('id', accountId);
    setSaving(false);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    toast.success(t('saved'));
  }

  async function handleToggleEnforced(next: boolean) {
    if (!accountId) return;
    setEnforced(next);
    const { error } = await supabase
      .from('accounts')
      .update({ broadcast_optout_enforced: next })
      .eq('id', accountId);
    if (error) {
      setEnforced(!next);
      toast.error(t('enforcedSaveFailed'));
      return;
    }
    toast.success(next ? t('enforcedOn') : t('enforcedOff'));
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
                onClick={handleSaveKeywords}
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
