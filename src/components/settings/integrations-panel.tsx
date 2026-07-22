'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ExternalLink, RefreshCw, Unplug, Send } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { useCan } from '@/hooks/use-can';
import {
  WEBHOOK_OUT_EVENTS,
  type WebhookOutEvent,
} from '@/lib/integrations/webhook-out-events';

interface SpreadsheetStatus {
  connected: boolean;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
}

export function IntegrationsPanel() {
  const t = useTranslations('settings.integrations');
  const tg = useTranslations('settings.integrations.googleSheets');
  const canEdit = useCan('edit-settings');
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<SpreadsheetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/integrations/google-sheets/spreadsheet');
      const data = await res.json();
      setStatus(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Consumes the ?google_connected=1 / ?google_error=... redirect params
  // left by /api/auth/google/callback, once, then strips them from the URL.
  const handledRedirect = useRef(false);
  useEffect(() => {
    if (handledRedirect.current) return;
    const connected = searchParams.get('google_connected');
    const error = searchParams.get('google_error');
    if (!connected && !error) return;
    handledRedirect.current = true;

    if (connected) {
      toast.success(tg('connectSuccess'));
      fetchStatus();
    } else if (error) {
      toast.error(tg('connectError'));
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete('google_connected');
    params.delete('google_error');
    router.replace(`/settings?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function handleSaveSpreadsheet() {
    if (!spreadsheetUrl.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/integrations/google-sheets/spreadsheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: spreadsheetUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(tg('spreadsheetSaved'));
      setSpreadsheetUrl('');
      await fetchStatus();
    } catch {
      toast.error(tg('spreadsheetSaveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateSpreadsheet() {
    setCreating(true);
    try {
      const res = await fetch('/api/integrations/google-sheets/spreadsheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ create: true, title: 'Funilly — Pipeline' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(tg('spreadsheetSaved'));
      await fetchStatus();
    } catch {
      toast.error(tg('spreadsheetSaveError'));
    } finally {
      setCreating(false);
    }
  }

  async function handleResync() {
    setResyncing(true);
    try {
      const res = await fetch('/api/integrations/google-sheets/resync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(tg('resyncSuccess', { deals: data.deals, tabs: data.tabs }));
    } catch {
      toast.error(tg('resyncError'));
    } finally {
      setResyncing(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch('/api/integrations/google-sheets/disconnect', { method: 'POST' });
      toast.success(tg('disconnectSuccess'));
      await fetchStatus();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-foreground">{tg('cardTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {tg('cardDescription')}
              </CardDescription>
            </div>
            {!loading ? (
              <Badge variant={status?.connected ? 'default' : 'secondary'}>
                {status?.connected ? tg('connected') : tg('notConnected')}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canEdit ? (
            <p className="text-xs text-muted-foreground">{tg('adminOnlyHint')}</p>
          ) : null}

          {!status?.connected ? (
            <a
              href="/api/integrations/google-sheets/connect"
              className={buttonVariants({ className: canEdit ? undefined : 'pointer-events-none opacity-50' })}
              aria-disabled={!canEdit}
            >
              {tg('connectButton')}
            </a>
          ) : (
            <>
              {status.spreadsheet_id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={status.spreadsheet_url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    <ExternalLink className="mr-2 size-4" />
                    {tg('openSpreadsheet')}
                  </a>
                  <Button onClick={handleResync} disabled={!canEdit || resyncing}>
                    <RefreshCw className="mr-2 size-4" />
                    {resyncing ? tg('resyncing') : tg('resyncButton')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{tg('noSpreadsheetHint')}</p>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">{tg('spreadsheetLabel')}</Label>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        value={spreadsheetUrl}
                        onChange={(e) => setSpreadsheetUrl(e.target.value)}
                        placeholder={tg('spreadsheetPlaceholder')}
                        disabled={!canEdit}
                        className="max-w-md"
                      />
                      <Button
                        variant="outline"
                        onClick={handleSaveSpreadsheet}
                        disabled={!canEdit || saving || !spreadsheetUrl.trim()}
                      >
                        {tg('saveSpreadsheetButton')}
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    {tg('orDivider')}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <Button variant="secondary" onClick={handleCreateSpreadsheet} disabled={!canEdit || creating}>
                    {tg('createSpreadsheetButton')}
                  </Button>
                </div>
              )}

              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                onClick={handleDisconnect}
                disabled={!canEdit || disconnecting}
              >
                <Unplug className="mr-2 size-4" />
                {tg('disconnectButton')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <div className="mt-6">
        <WebhookOutPanel canEdit={canEdit} />
      </div>
    </section>
  );
}

const WEBHOOK_OUT_EVENT_LABEL_KEY: Record<WebhookOutEvent, string> = {
  MESSAGES_UPSERT: 'eventMessagesUpsert',
  MESSAGE_SENT: 'eventMessageSent',
  CONVERSATION_CREATED: 'eventConversationCreated',
  CONTACT_CREATED: 'eventContactCreated',
  DEAL_CREATED: 'eventDealCreated',
  DEAL_WON: 'eventDealWon',
  DEAL_LOST: 'eventDealLost',
};

interface WebhookOutStatus {
  url: string;
  events: WebhookOutEvent[];
  is_active: boolean;
}

function WebhookOutPanel({ canEdit }: { canEdit: boolean }) {
  const tw = useTranslations('settings.integrations.webhookOut');

  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Set<WebhookOutEvent>>(new Set());
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/integrations/webhook-out');
      const data: WebhookOutStatus = await res.json();
      setUrl(data.url ?? '');
      setEvents(new Set(data.events ?? []));
      setIsActive(data.is_active ?? true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  function toggleEvent(event: WebhookOutEvent) {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  }

  async function handleSave() {
    if (!url.trim()) {
      toast.error(tw('urlRequired'));
      return;
    }
    if (events.size === 0) {
      toast.error(tw('eventsRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/integrations/webhook-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          events: Array.from(events),
          is_active: isActive,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(tw('saveSuccess'));
    } catch (err) {
      const reason = err instanceof Error ? err.message : tw('saveError');
      toast.error(reason);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!url.trim()) {
      toast.error(tw('urlRequired'));
      return;
    }
    setTesting(true);
    try {
      const res = await fetch('/api/integrations/webhook-out/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.ok) {
        toast.success(tw('testSuccess', { status: data.status }));
      } else {
        toast.error(tw('testFailure', { reason: data.error || `HTTP ${data.status}` }));
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      toast.error(tw('testFailure', { reason }));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-foreground">{tw('cardTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {tw('cardDescription')}
            </CardDescription>
          </div>
          {!loading ? (
            <Badge variant={isActive ? 'default' : 'secondary'}>
              {isActive ? tw('active') : tw('inactive')}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canEdit ? (
          <p className="text-xs text-muted-foreground">{tw('adminOnlyHint')}</p>
        ) : null}

        <div className="space-y-2">
          <Label className="text-muted-foreground">{tw('urlLabel')}</Label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={tw('urlPlaceholder')}
            disabled={!canEdit || loading}
            className="max-w-md"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground">{tw('eventsLabel')}</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {WEBHOOK_OUT_EVENTS.map((event) => (
              <label
                key={event}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <Checkbox
                  checked={events.has(event)}
                  onCheckedChange={() => toggleEvent(event)}
                  disabled={!canEdit || loading}
                />
                {tw(WEBHOOK_OUT_EVENT_LABEL_KEY[event])}
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch
            checked={isActive}
            onCheckedChange={(v) => setIsActive(!!v)}
            disabled={!canEdit || loading}
          />
          {tw('activeToggleLabel')}
        </label>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={handleSave} disabled={!canEdit || loading || saving}>
            {saving ? tw('saving') : tw('saveButton')}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={!canEdit || loading || testing}>
            <Send className="mr-2 size-4" />
            {testing ? tw('testing') : tw('testButton')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
