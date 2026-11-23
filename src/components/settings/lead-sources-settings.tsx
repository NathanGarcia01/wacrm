'use client';

// ============================================================
// LeadSourcesSettings — Settings → Fontes de captação
//
// Fase 3A: one source = one public webhook URL (unguessable token in
// the path) that a landing page / ad platform / form builder POSTs a
// lead to. On receipt, it creates-or-matches the contact (dedup by
// phone, same rule as everywhere else in the app) and opens a deal in
// the configured pipeline/stage.
//
// Gated by the `hasAPI` plan feature (Business), same dimension as
// the public REST API and outbound webhooks — accounts without it see
// the upsell card instead of the roster, same pattern as
// followup-settings.tsx / routing-settings.tsx.
//
// One-time reveal: the webhook URL (the token IS the credential) is
// shown exactly once, right after creation. After the dialog closes,
// only "URL oculta" remains — if lost, deactivate the source and
// create a new one. Toggling `is_active` doesn't need the plaintext,
// so that keeps working regardless.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, Lock, Loader2, Plus, Send, Webhook } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RequireRole } from '@/components/auth/require-role';
import { usePlanFeatures } from '@/hooks/use-feature-gate';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { SettingsPanelHead } from './settings-panel-head';

const SELECT_CLASS =
  'w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none';

interface Pipeline {
  id: string;
  name: string;
}
interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
}
interface LeadOrigin {
  id: string;
  label: string;
}

interface Relation {
  id: string;
  name?: string;
  label?: string;
}

interface LeadSourceRow {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  pipeline_id: string;
  stage_id: string;
  lead_origin_id: string | null;
  pipelines: Relation | Relation[] | null;
  pipeline_stages: Relation | Relation[] | null;
  lead_origins: Relation | Relation[] | null;
}

interface LeadSourceEvent {
  id: string;
  status: 'ok' | 'error';
  contact_outcome: 'created' | 'matched' | null;
  deal_outcome: 'created' | 'skipped_duplicate' | null;
  error_message: string | null;
  payload_summary: { name?: string | null; phone?: string | null; is_test?: boolean };
  created_at: string;
}

function one(value: Relation | Relation[] | null | undefined): Relation | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LeadSourcesSettings() {
  const t = useTranslations('settings.leadSources');
  const router = useRouter();
  const { hasAPI } = usePlanFeatures();
  const { canEditSettings } = useAuth();

  const [sources, setSources] = useState<LeadSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [eventsFor, setEventsFor] = useState<LeadSourceRow | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/lead-sources', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('loadFailed'));
        return;
      }
      const data = (await res.json()) as { sources: LeadSourceRow[] };
      setSources(data.sources);
    } catch (err) {
      console.error('[LeadSourcesSettings] load error:', err);
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (hasAPI) void load();
    else setLoading(false);
  }, [hasAPI, load]);

  async function handleToggleActive(source: LeadSourceRow, next: boolean) {
    setTogglingId(source.id);
    try {
      const res = await fetch(`/api/account/lead-sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('updateFailed'));
        return;
      }
      setSources((prev) => prev.map((s) => (s.id === source.id ? { ...s, is_active: next } : s)));
    } catch (err) {
      console.error('[LeadSourcesSettings] toggle error:', err);
      toast.error(t('networkError'));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleTest(source: LeadSourceRow) {
    setTestingId(source.id);
    try {
      const res = await fetch(`/api/account/lead-sources/${source.id}/test`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('testFailed'));
        return;
      }
      toast.success(t('testSent'));
      if (eventsFor?.id === source.id) {
        setEventsFor({ ...source }); // trigger the dialog's own reload via key change below
      }
    } catch (err) {
      console.error('[LeadSourcesSettings] test error:', err);
      toast.error(t('networkError'));
    } finally {
      setTestingId(null);
    }
  }

  if (!hasAPI) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="size-4" />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-10 text-center">
            <Lock className="size-6 text-muted-foreground" />
            <p className="font-medium text-foreground">{t('upsellTitle')}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t('upsellDescription')}</p>
            <Button onClick={() => router.push('/settings?tab=overview')}>{t('upsellButton')}</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <RequireRole min="admin">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t('newSource')}
            </Button>
          </RequireRole>
        }
      />

      {sources.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Webhook className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {sources.map((source) => {
                const pipeline = one(source.pipelines);
                const stage = one(source.pipeline_stages);
                const origin = one(source.lead_origins);
                return (
                  <li
                    key={source.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`truncate text-sm font-medium ${
                            source.is_active ? 'text-foreground' : 'text-muted-foreground line-through'
                          }`}
                        >
                          {source.name}
                        </span>
                        {!source.is_active && (
                          <Badge className="border-border bg-muted text-muted-foreground text-[10px] tracking-wide uppercase">
                            {t('statusInactive')}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <Badge className="border-border bg-muted text-muted-foreground text-[10px]">
                          {pipeline?.name ?? '—'} → {stage?.name ?? '—'}
                        </Badge>
                        {origin ? (
                          <Badge className="border-border bg-muted text-muted-foreground text-[10px]">
                            {origin.label}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground mt-1.5 text-xs">
                        {t('urlHidden')} · {t('createdOn', { date: fmtDateTime(source.created_at) })}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
                      <Button variant="outline" size="sm" onClick={() => setEventsFor(source)}>
                        {t('viewEvents')}
                      </Button>
                      <RequireRole min="admin">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTest(source)}
                          disabled={testingId === source.id || !source.is_active}
                        >
                          {testingId === source.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Send className="size-4" />
                          )}
                          {t('sendTest')}
                        </Button>
                        <Switch
                          checked={source.is_active}
                          onCheckedChange={(v) => handleToggleActive(source, v === true)}
                          disabled={togglingId === source.id}
                        />
                      </RequireRole>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {canEditSettings ? (
        <CreateSourceDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
      ) : null}

      <EventsDialog source={eventsFor} onOpenChange={(open) => !open && setEventsFor(null)} />
    </section>
  );
}

// ------------------------------------------------------------
// Create dialog — form → one-time URL reveal.
// ------------------------------------------------------------

function CreateSourceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations('settings.leadSources');
  const tCommon = useTranslations('common');

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [origins, setOrigins] = useState<LeadOrigin[]>([]);
  const [name, setName] = useState('');
  const [stageId, setStageId] = useState('');
  const [leadOriginId, setLeadOriginId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    void (async () => {
      const [{ data: pipelineRows }, { data: stageRows }, { data: originRows }] = await Promise.all([
        supabase.from('pipelines').select('id, name').order('name'),
        supabase.from('pipeline_stages').select('id, pipeline_id, name, position').order('position'),
        supabase.from('lead_origins').select('id, label').eq('is_active', true).order('position'),
      ]);
      setPipelines(pipelineRows ?? []);
      setStages(stageRows ?? []);
      setOrigins(originRows ?? []);
    })();
  }, [open]);

  const stageToPipeline = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of stages) map.set(s.id, s.pipeline_id);
    return map;
  }, [stages]);

  function reset() {
    setName('');
    setStageId('');
    setLeadOriginId('');
    setSubmitting(false);
    setCreatedUrl(null);
  }

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('nameRequired'));
      return;
    }
    if (!stageId) {
      toast.error(t('stageRequired'));
      return;
    }
    const pipelineId = stageToPipeline.get(stageId);
    if (!pipelineId) {
      toast.error(t('stageRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/account/lead-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          pipelineId,
          stageId,
          leadOriginId: leadOriginId || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('createFailed'));
        return;
      }
      setCreatedUrl(payload.webhookUrl as string);
      onCreated();
    } catch (err) {
      console.error('[CreateSourceDialog] create error:', err);
      toast.error(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyUrl() {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="border-border bg-popover sm:max-w-md">
        {createdUrl ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t('revealTitle')}</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('revealDescription')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('urlLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={createdUrl}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={copyUrl}>
                  <Copy className="size-4" />
                  {tCommon('copy')}
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                {tCommon('done')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t('newSource')}</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('createDescription')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="lead-source-name" className="text-muted-foreground">
                  {tCommon('name')}
                </Label>
                <Input
                  id="lead-source-name"
                  value={name}
                  maxLength={80}
                  placeholder={t('namePlaceholder')}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t('stageLabel')}</Label>
                <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={SELECT_CLASS}>
                  <option value="">{t('selectStage')}</option>
                  {pipelines.map((p) => {
                    const pipelineStages = stages
                      .filter((s) => s.pipeline_id === p.id)
                      .sort((a, b) => a.position - b.position);
                    if (pipelineStages.length === 0) return null;
                    return (
                      <optgroup key={p.id} label={p.name}>
                        {pipelineStages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t('originLabel')}</Label>
                <select
                  value={leadOriginId}
                  onChange={(e) => setLeadOriginId(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">{t('originNone')}</option>
                  {origins.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {tCommon('cancel')}
              </Button>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : t('createSource')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Events dialog — "Últimos recebimentos" for one source.
// ------------------------------------------------------------

function EventsDialog({
  source,
  onOpenChange,
}: {
  source: LeadSourceRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('settings.leadSources');
  const [events, setEvents] = useState<LeadSourceEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/account/lead-sources/${id}/events`, { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) setEvents(payload.events ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (source) void load(source.id);
    else setEvents([]);
  }, [source, load]);

  return (
    <Dialog open={!!source} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('eventsTitle')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{source?.name}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-primary size-5 animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">{t('noEvents')}</p>
        ) : (
          <ul className="divide-border max-h-96 divide-y overflow-y-auto">
            {events.map((ev) => (
              <li key={ev.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="text-foreground truncate font-medium">
                    {ev.payload_summary.name || ev.payload_summary.phone || '—'}
                    {ev.payload_summary.is_test ? (
                      <span className="text-muted-foreground ml-1.5 text-xs">{t('testBadge')}</span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {ev.status === 'ok'
                      ? t('eventOk', {
                          contact: ev.contact_outcome === 'created' ? t('contactCreated') : t('contactMatched'),
                          deal:
                            ev.deal_outcome === 'created'
                              ? t('dealCreated')
                              : ev.deal_outcome === 'skipped_duplicate'
                                ? t('dealSkipped')
                                : '',
                        })
                      : (ev.error_message ?? t('eventError'))}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge
                    className={
                      ev.status === 'ok'
                        ? 'border-border bg-muted text-muted-foreground text-[10px]'
                        : 'border-destructive/40 bg-destructive/10 text-destructive text-[10px]'
                    }
                  >
                    {ev.status === 'ok' ? t('statusOk') : t('statusError')}
                  </Badge>
                  <p className="text-muted-foreground mt-1 text-[11px]">{fmtDateTime(ev.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
