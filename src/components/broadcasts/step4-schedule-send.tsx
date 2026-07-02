'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Send,
  Loader2,
  Users,
  Save,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Clock,
} from 'lucide-react';
import {
  BATCH_SIZE_MIN,
  BATCH_SIZE_MAX,
  BATCH_INTERVAL_MINUTES_MIN,
  BATCH_INTERVAL_MINUTES_MAX,
  DEFAULT_CADENCE,
  estimateCadence,
  type CadenceSettings,
} from '@/lib/broadcast-cadence';

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: (cadence: CadenceSettings, scheduledAt: Date | null) => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

type QualityRating = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';

function normalizeQuality(raw: string | null): QualityRating {
  if (raw === 'GREEN' || raw === 'YELLOW' || raw === 'RED') return raw;
  // Meta has historically also returned HIGH/MEDIUM/LOW on some API
  // versions — map those onto the same three buckets.
  if (raw === 'HIGH') return 'GREEN';
  if (raw === 'MEDIUM') return 'YELLOW';
  if (raw === 'LOW') return 'RED';
  return 'UNKNOWN';
}

function QualityBadge({ quality, loading }: { quality: QualityRating; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking account quality…
      </div>
    );
  }

  const config: Record<
    QualityRating,
    { label: string; classes: string; icon: React.ReactNode; warning?: string }
  > = {
    GREEN: {
      label: 'Qualidade alta — seguro para disparar',
      classes: 'border-primary/30 bg-primary/10 text-primary',
      icon: <ShieldCheck className="h-4 w-4" />,
    },
    YELLOW: {
      label: 'Qualidade média — dispare com cautela e reduza o volume',
      classes: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
      icon: <ShieldAlert className="h-4 w-4" />,
    },
    RED: {
      label: 'Qualidade baixa — risco alto de banimento',
      classes: 'border-red-500/30 bg-red-500/10 text-red-400',
      icon: <ShieldAlert className="h-4 w-4" />,
      warning: 'Sua conta está em risco. Recomendamos não disparar agora.',
    },
    UNKNOWN: {
      label: 'Não foi possível verificar a qualidade da conta',
      classes: 'border-border bg-card/50 text-muted-foreground',
      icon: <ShieldQuestion className="h-4 w-4" />,
    },
  };
  const c = config[quality];

  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm font-medium ${c.classes}`}>
        {c.icon}
        {c.label}
      </div>
      {c.warning && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-400">
          {c.warning}
        </p>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h${mins}min` : `${hours}h`;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);

  const [quality, setQuality] = useState<QualityRating>('UNKNOWN');
  const [loadingQuality, setLoadingQuality] = useState(true);

  const [cadence, setCadence] = useState<CadenceSettings>(DEFAULT_CADENCE);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });
          setEstimatedReach(count ?? 0);
        } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
          const { data: contactTags } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.tagIds);

          const uniqueIds = new Set((contactTags ?? []).map((ct) => ct.contact_id));
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  useEffect(() => {
    let cancelled = false;
    async function loadQuality() {
      setLoadingQuality(true);
      try {
        const res = await fetch('/api/whatsapp/quality');
        const data = await res.json();
        if (!cancelled) {
          setQuality(res.ok ? normalizeQuality(data.quality_rating ?? null) : 'UNKNOWN');
        }
      } catch {
        if (!cancelled) setQuality('UNKNOWN');
      } finally {
        if (!cancelled) setLoadingQuality(false);
      }
    }
    loadQuality();
    return () => {
      cancelled = true;
    };
  }, []);

  const audienceLabel =
    audience.type === 'all'
      ? 'All Contacts'
      : audience.type === 'tags'
        ? `Tags (${audience.tagIds?.length ?? 0} selected)`
        : audience.type === 'csv'
          ? 'CSV Upload'
          : 'Custom';

  const scheduledAt: Date | null =
    scheduleEnabled && scheduleDate && scheduleTime
      ? new Date(`${scheduleDate}T${scheduleTime}`)
      : null;

  const scheduleInvalid = scheduleEnabled && (!scheduleDate || !scheduleTime || (scheduledAt && scheduledAt.getTime() <= Date.now()));

  const estimate = estimateCadence(estimatedReach, cadence);
  const startInstant = scheduledAt ?? new Date();
  const completionLow = new Date(startInstant.getTime() + estimate.lowSeconds * 1000);
  const completionHigh = new Date(startInstant.getTime() + estimate.highSeconds * 1000);

  function patchCadence(patch: Partial<CadenceSettings>) {
    setCadence((prev) => ({ ...prev, ...patch }));
  }

  const canConfirm = !!name.trim() && !isProcessing && !scheduleInvalid;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Review & Send</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Name your broadcast, review the details, and send.
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">Broadcast Name</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Summer Sale Announcement"
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Account quality */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Account quality</h3>
        <QualityBadge quality={quality} loading={loadingQuality} />
      </div>

      {/* Cadence controls */}
      <div className="space-y-4 rounded-xl border border-border bg-card/50 p-4">
        <p className="text-sm font-medium text-foreground">Cadência de envio (anti-banimento)</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">
              Tamanho do lote ({BATCH_SIZE_MIN}-{BATCH_SIZE_MAX} mensagens)
            </Label>
            <Input
              type="number"
              min={BATCH_SIZE_MIN}
              max={BATCH_SIZE_MAX}
              value={cadence.batchSize}
              onChange={(e) =>
                patchCadence({
                  batchSize: Math.min(
                    BATCH_SIZE_MAX,
                    Math.max(BATCH_SIZE_MIN, Number(e.target.value) || BATCH_SIZE_MIN),
                  ),
                })
              }
              className="border-border bg-muted text-foreground"
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">
              Intervalo entre lotes ({BATCH_INTERVAL_MINUTES_MIN}-{BATCH_INTERVAL_MINUTES_MAX} min)
            </Label>
            <Input
              type="number"
              min={BATCH_INTERVAL_MINUTES_MIN}
              max={BATCH_INTERVAL_MINUTES_MAX}
              value={cadence.batchIntervalMinutes}
              onChange={(e) =>
                patchCadence({
                  batchIntervalMinutes: Math.min(
                    BATCH_INTERVAL_MINUTES_MAX,
                    Math.max(BATCH_INTERVAL_MINUTES_MIN, Number(e.target.value) || BATCH_INTERVAL_MINUTES_MIN),
                  ),
                })
              }
              className="border-border bg-muted text-foreground"
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">
              Delay mínimo entre mensagens (segundos)
            </Label>
            <Input
              type="number"
              min={1}
              value={cadence.messageDelayMinSeconds}
              onChange={(e) =>
                patchCadence({ messageDelayMinSeconds: Math.max(1, Number(e.target.value) || 1) })
              }
              className="border-border bg-muted text-foreground"
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">
              Delay máximo entre mensagens (segundos)
            </Label>
            <Input
              type="number"
              min={cadence.messageDelayMinSeconds}
              value={cadence.messageDelayMaxSeconds}
              onChange={(e) =>
                patchCadence({
                  messageDelayMaxSeconds: Math.max(
                    cadence.messageDelayMinSeconds,
                    Number(e.target.value) || cadence.messageDelayMinSeconds,
                  ),
                })
              }
              className="border-border bg-muted text-foreground"
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5">
          <Checkbox
            checked={cadence.respectBusinessHours}
            onCheckedChange={(checked) => patchCadence({ respectBusinessHours: checked === true })}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm text-foreground">Respeitar horário comercial</span>
            <span className="block text-xs text-muted-foreground">
              Envia só entre 08:00 e 20:00 (horário de Brasília). Fora disso, pausa e retoma no
              próximo horário permitido.
            </span>
          </span>
        </label>
      </div>

      {/* Scheduling */}
      <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">Agendar para depois</p>
            <p className="text-xs text-muted-foreground">
              {scheduleEnabled ? 'O disparo começa na data/hora escolhida.' : 'Dispara imediatamente ao confirmar.'}
            </p>
          </div>
          <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} aria-label="Agendar para depois" />
        </div>

        {scheduleEnabled && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Data</Label>
              <Input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Hora</Label>
              <Input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>
            {scheduleInvalid && (
              <p className="text-xs text-red-400 sm:col-span-2">
                Escolha uma data e hora no futuro.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Summary Card */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">Summary</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Template</p>
            <p className="text-foreground">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Audience</p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estimated Reach</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-foreground">{estimatedReach.toLocaleString()}</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Language</p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
        </div>

        {!loadingReach && estimatedReach > 0 && (
          <div className="flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {estimatedReach.toLocaleString()} contatos em {estimate.totalBatches}{' '}
              {estimate.totalBatches === 1 ? 'lote' : 'lotes'} de até {cadence.batchSize} msgs, ~
              {formatDuration(estimate.lowSeconds)}-{formatDuration(estimate.highSeconds)} de envio
              (estimativa, não considera pausas por horário comercial).
              <br />
              Conclusão estimada:{' '}
              {completionLow.toLocaleString()} – {completionHigh.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">Preparing broadcast...</p>
            </div>
            <span className="text-xs font-medium text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save as Draft
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <DialogTrigger
            render={
              <Button
                disabled={!canConfirm}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              />
            }
          >
            <Send className="h-4 w-4" />
            {scheduleEnabled ? 'Schedule Broadcast' : 'Send Broadcast'}
          </DialogTrigger>
          <DialogContent className="border-border bg-popover sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">Confirm Broadcast</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                You are about to send this broadcast to{' '}
                <span className="font-medium text-popover-foreground">{estimatedReach.toLocaleString()}</span>{' '}
                contacts using the{' '}
                <span className="font-medium text-popover-foreground">{template.name}</span> template.
                {scheduledAt && (
                  <>
                    {' '}It will start on{' '}
                    <span className="font-medium text-popover-foreground">
                      {scheduledAt.toLocaleString()}
                    </span>
                    .
                  </>
                )}{' '}
                This action cannot be undone.
                {quality === 'RED' && (
                  <span className="mt-2 block font-medium text-red-400">
                    Aviso: sua conta está com qualidade baixa — o risco de banimento é alto.
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConfirm(false)}
                className="border-border text-muted-foreground"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setShowConfirm(false);
                  onSend(cadence, scheduledAt);
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Send className="h-4 w-4" />
                Confirm & Send
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </div>
  );
}
