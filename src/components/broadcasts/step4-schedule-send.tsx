'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  stageId?: string;
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: (cadence: CadenceSettings, scheduledAt: Date | null, channelId: string | null) => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

interface WhatsAppChannelOption {
  id: string;
  name: string;
  display_phone_number: string | null;
  is_default: boolean;
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
  const t = useTranslations('broadcasts.step4');
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('checkingQuality')}
      </div>
    );
  }

  const config: Record<
    QualityRating,
    { label: string; classes: string; icon: React.ReactNode; warning?: string }
  > = {
    GREEN: {
      label: t('qualityHigh'),
      classes: 'border-primary/30 bg-primary/10 text-primary',
      icon: <ShieldCheck className="h-4 w-4" />,
    },
    YELLOW: {
      label: t('qualityMedium'),
      classes: 'border-gold/30 bg-gold-soft text-gold',
      icon: <ShieldAlert className="h-4 w-4" />,
    },
    RED: {
      label: t('qualityLow'),
      classes: 'border-destructive/30 bg-destructive/10 text-destructive',
      icon: <ShieldAlert className="h-4 w-4" />,
      warning: t('qualityLowWarning'),
    },
    UNKNOWN: {
      label: t('qualityUnknown'),
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
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
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
  const t = useTranslations('broadcasts.step4');
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);

  const [quality, setQuality] = useState<QualityRating>('UNKNOWN');
  const [loadingQuality, setLoadingQuality] = useState(true);

  const [channels, setChannels] = useState<WhatsAppChannelOption[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

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
        } else if (audience.type === 'pipeline_stage' && audience.stageId) {
          const { data } = await supabase
            .from('deals')
            .select('contact_id')
            .eq('stage_id', audience.stageId)
            .eq('status', 'open');
          const uniqueIds = new Set(
            (data ?? [])
              .map((d) => d.contact_id as string | null)
              .filter((id): id is string => Boolean(id)),
          );
          setEstimatedReach(uniqueIds.size);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  // Load the account's active WhatsApp channels once so the user can pick
  // which number sends this broadcast. Pre-select the account's default
  // channel — matches what a send would fall back to anyway if left
  // unset (see src/lib/whatsapp/channels.ts's resolveDefaultChannel).
  useEffect(() => {
    let cancelled = false;
    async function loadChannels() {
      try {
        const res = await fetch('/api/whatsapp/channels');
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const active: WhatsAppChannelOption[] = (data.channels ?? []).filter(
          (c: { is_active: boolean }) => c.is_active,
        );
        setChannels(active);
        const defaultChannel = active.find((c) => c.is_default) ?? active[0];
        if (defaultChannel) setSelectedChannelId(defaultChannel.id);
      } catch {
        // Best-effort — leaving channels empty just hides the selector,
        // and sends fall back to the account's default channel server-side.
      }
    }
    loadChannels();
    return () => {
      cancelled = true;
    };
  }, []);

  // Base UI's <Select> only resolves the trigger's displayed label from
  // its `items` map (or from the popup's <SelectItem> children once the
  // popup has actually been opened) — without `items`, a freshly loaded
  // list briefly shows the raw channel id instead of its name.
  const channelItems = useMemo(
    () =>
      Object.fromEntries(
        channels.map((c) => [c.id, c.display_phone_number ? `${c.name} (${c.display_phone_number})` : c.name]),
      ),
    [channels],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadQuality() {
      setLoadingQuality(true);
      try {
        const url = selectedChannelId
          ? `/api/whatsapp/quality?channel_id=${selectedChannelId}`
          : '/api/whatsapp/quality';
        const res = await fetch(url);
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
  }, [selectedChannelId]);

  const audienceLabel =
    audience.type === 'all'
      ? t('allContacts')
      : audience.type === 'tags'
        ? t('tagsSelected', { count: audience.tagIds?.length ?? 0 })
        : audience.type === 'csv'
          ? t('csvUpload')
          : audience.type === 'pipeline_stage'
            ? t('pipelineStage')
            : t('custom');

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
        <h2 className="text-lg font-semibold text-foreground">{t('reviewAndSend')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('reviewAndSendHint')}
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">{t('broadcastName')}</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('broadcastNamePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Channel selection — only worth showing when there's a real choice */}
      {channels.length > 1 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">{t('sendFromChannel')}</Label>
          <Select
            items={channelItems}
            value={selectedChannelId ?? undefined}
            onValueChange={(v) => v && setSelectedChannelId(v)}
          >
            <SelectTrigger className="w-full border-border bg-muted text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-border bg-popover">
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.display_phone_number ? `${c.name} (${c.display_phone_number})` : c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Account quality */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">{t('accountQuality')}</h3>
        <QualityBadge quality={quality} loading={loadingQuality} />
      </div>

      {/* Cadence controls */}
      <div className="space-y-4 rounded-xl border border-border bg-card/50 p-4">
        <p className="text-sm font-medium text-foreground">{t('cadenceTitle')}</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">
              {t('batchSizeLabel', { min: BATCH_SIZE_MIN, max: BATCH_SIZE_MAX })}
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
              {t('batchIntervalLabel', { min: BATCH_INTERVAL_MINUTES_MIN, max: BATCH_INTERVAL_MINUTES_MAX })}
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
              {t('minDelayLabel')}
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
              {t('maxDelayLabel')}
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
            <span className="block text-sm text-foreground">{t('respectBusinessHours')}</span>
            <span className="block text-xs text-muted-foreground">
              {t('respectBusinessHoursHint')}
            </span>
          </span>
        </label>
      </div>

      {/* Scheduling */}
      <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">{t('scheduleForLater')}</p>
            <p className="text-xs text-muted-foreground">
              {scheduleEnabled ? t('scheduleEnabledHint') : t('scheduleDisabledHint')}
            </p>
          </div>
          <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} aria-label={t('scheduleForLater')} />
        </div>

        {scheduleEnabled && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">{t('dateLabel')}</Label>
              <Input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">{t('timeLabel')}</Label>
              <Input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>
            {scheduleInvalid && (
              <p className="text-xs text-destructive sm:col-span-2">
                {t('futureDateHint')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Summary Card */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">{t('summary')}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t('templateLabel')}</p>
            <p className="text-foreground">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('audienceLabel')}</p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('estimatedReach')}</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-mono font-medium text-foreground">{estimatedReach.toLocaleString()}</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('languageLabel')}</p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
        </div>

        {!loadingReach && estimatedReach > 0 && (
          <div className="flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {t('summaryEstimate', {
                count: estimatedReach.toLocaleString(),
                batches: estimate.totalBatches,
                batchWord: estimate.totalBatches === 1 ? t('batch') : t('batches'),
                batchSize: cadence.batchSize,
                low: formatDuration(estimate.lowSeconds),
                high: formatDuration(estimate.highSeconds),
              })}
              <br />
              {t('estimatedCompletion')}{' '}
              <span className="font-mono">{completionLow.toLocaleString()} – {completionHigh.toLocaleString()}</span>
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
              <p className="text-sm font-medium text-foreground">{t('preparingBroadcast')}</p>
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
          {t('back')}
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
              {t('saveAsDraft')}
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
            {scheduleEnabled ? t('scheduleBroadcast') : t('sendBroadcast')}
          </DialogTrigger>
          <DialogContent className="border-border bg-popover sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t('confirmBroadcast')}</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('confirmBroadcastPrefix')}{' '}
                <span className="font-mono font-medium text-popover-foreground">{estimatedReach.toLocaleString()}</span>{' '}
                {t('confirmBroadcastMiddle')}{' '}
                <span className="font-medium text-popover-foreground">{template.name}</span> {t('confirmBroadcastTemplateSuffix')}
                {scheduledAt && (
                  <>
                    {' '}{t('itWillStartOn')}{' '}
                    <span className="font-mono font-medium text-popover-foreground">
                      {scheduledAt.toLocaleString()}
                    </span>
                    .
                  </>
                )}{' '}
                {t('actionCannotBeUndone')}
                {quality === 'RED' && (
                  <span className="mt-2 block font-medium text-destructive">
                    {t('lowQualityWarning')}
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
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  setShowConfirm(false);
                  onSend(cadence, scheduledAt, selectedChannelId);
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Send className="h-4 w-4" />
                {t('confirmAndSend')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </div>
  );
}
