'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate, WhatsAppChannelOption } from '@/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, FileText, ArrowRight } from 'lucide-react';

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  Utility: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Authentication: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

interface Step1Props {
  channels: WhatsAppChannelOption[];
  channelId: string | null;
  onChannelChange: (channelId: string) => void;
  selectedTemplate: MessageTemplate | null;
  onSelect: (template: MessageTemplate) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step1ChooseTemplate({
  channels,
  channelId,
  onChannelChange,
  selectedTemplate,
  onSelect,
  onNext,
  onBack,
}: Step1Props) {
  const t = useTranslations('broadcasts.step1');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === channelId) ?? null,
    [channels, channelId],
  );
  const wabaId = selectedChannel?.waba_id ?? null;

  const channelItems = useMemo(
    () =>
      Object.fromEntries(
        channels.map((c) => [
          c.id,
          c.display_phone_number ? `${c.name} (${c.display_phone_number})` : c.name,
        ]),
      ),
    [channels],
  );

  // Template list only loads once a number is chosen — and is scoped
  // to that number's WABA (migration 105): a template approved on
  // another WABA can't be sent through this number, so it must never
  // even show up as an option here.
  useEffect(() => {
    if (!wabaId) {
      setTemplates([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function fetchTemplates() {
      try {
        setLoading(true);
        const supabase = createClient();
        // Only APPROVED templates can be sent via Meta — anything else
        // would 400 at broadcast time. Hide them rather than letting
        // the user pick a template that will fail.
        const { data, error: fetchError } = await supabase
          .from('message_templates')
          .select('*')
          .eq('status', 'APPROVED')
          // Not in any currently-connected WABA (migration 105) — a
          // broadcast picking it would fail the same way a deleted
          // template would.
          .eq('orphaned', false)
          .eq('waba_id', wabaId)
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;
        if (!cancelled) setTemplates(data ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTemplates();
    return () => {
      cancelled = true;
    };
  }, [wabaId, t]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('subtitle')}
        </p>
      </div>

      {/* Number first — the template list below only exists once this
          is set, and is scoped to its WABA. */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">{t('sendFromChannel')}</Label>
        {channels.length > 0 ? (
          <>
            <Select
              items={channelItems}
              value={channelId ?? undefined}
              onValueChange={(v) => v && onChannelChange(v)}
            >
              <SelectTrigger className="w-full border-border bg-muted text-foreground">
                <SelectValue placeholder={t('selectChannelPlaceholder')} />
              </SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.display_phone_number ? `${c.name} (${c.display_phone_number})` : c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('chooseChannelHint')}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noChannelConfigured')}</p>
        )}
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      ) : templates.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-border bg-card/50">
          <FileText className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('noTemplates')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('createTemplateHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const isSelected = selectedTemplate?.id === template.id;
            const catColor = categoryColors[template.category] ?? categoryColors.Utility;

            return (
              <button
                key={template.id}
                onClick={() => onSelect(template)}
                className={`flex flex-col gap-3 rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : 'border-border bg-card/50 hover:border-border hover:bg-card'
                }`}
              >
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-medium text-foreground">{template.name}</h3>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${catColor}`}
                  >
                    {template.category}
                  </span>
                </div>
                <p className="line-clamp-3 text-xs text-muted-foreground">{template.body_text}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{template.language ?? 'en_US'}</span>
                  {/* Status is omitted on purpose — every template
                      shown here is already filtered to APPROVED,
                      so the chip carried no information. */}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} className="border-border text-muted-foreground">
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!selectedTemplate}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
