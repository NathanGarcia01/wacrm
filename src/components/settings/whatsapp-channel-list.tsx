'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { WhatsAppChannelFormDialog } from './whatsapp-channel-form-dialog';
import { WhatsAppChannelTypePicker } from './whatsapp-channel-type-picker';
import { EvolutionChannelDialog } from './evolution-channel-dialog';
import { usePlanFeatures } from '@/hooks/use-feature-gate';
import { UpgradeBadge } from '@/components/billing/upgrade-badge';

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const META_EMBEDDED_SIGNUP_CONFIG_ID = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID;
const FACEBOOK_SDK_SCRIPT_ID = 'facebook-jssdk';

type FacebookLoginResponse = { authResponse?: { code?: string } };

declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (params: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
      login: (callback: (response: FacebookLoginResponse) => void, params: Record<string, unknown>) => void;
    };
  }
}

// Loads Meta's JS SDK once (idempotent — safe to call on every mount) and
// initializes FB.init via the fbAsyncInit hook the SDK itself calls once
// the script has loaded. Required for FB.login's config_id-based Embedded
// Signup — the popup and WABA/number picker it opens are entirely Meta's
// own UI, not something we assemble a dialog URL for ourselves.
function loadFacebookSdk() {
  if (typeof window === 'undefined' || document.getElementById(FACEBOOK_SDK_SCRIPT_ID)) return;
  window.fbAsyncInit = () => {
    window.FB?.init({
      appId: META_APP_ID!,
      autoLogAppEvents: true,
      xfbml: true,
      version: 'v22.0',
    });
  };
  const script = document.createElement('script');
  script.id = FACEBOOK_SDK_SCRIPT_ID;
  script.async = true;
  script.defer = true;
  script.crossOrigin = 'anonymous';
  script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
  document.body.appendChild(script);
}

export interface WhatsAppChannel {
  id: string;
  name: string;
  phone_number_id: string;
  waba_id: string | null;
  display_phone_number: string | null;
  is_active: boolean;
  is_default: boolean;
  registered: boolean;
  last_registration_error: string | null;
  created_at: string;
  channel_type: 'cloud_api' | 'evolution';
  evolution_status: 'open' | 'connecting' | 'close' | 'disconnected' | null;
}

/**
 * Settings → WhatsApp channel list. Replaces the old one-row form: an
 * account can now connect several numbers, each an independent
 * whatsapp_channels row (see src/lib/whatsapp/channels.ts for how a
 * conversation/broadcast resolves which one to send through).
 */
export function WhatsAppChannelList() {
  const t = useTranslations('settings.whatsapp.channels');
  const tCommon = useTranslations('common');

  const [channels, setChannels] = useState<WhatsAppChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<WhatsAppChannel | null>(null);
  // Id of the channel with an action in flight — disables its row's
  // buttons so a double-click can't fire the same PATCH/DELETE twice.
  const [busyId, setBusyId] = useState<string | null>(null);

  // "Adicionar número" flow: type picker → (Embedded Signup popup |
  // Cloud API form | Evolution QR dialog). evolutionDialog also doubles
  // as the "Reconectar" flow for an existing channel (reconnectChannelId
  // set, name step skipped).
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [evolutionDialogOpen, setEvolutionDialogOpen] = useState(false);
  const [reconnectChannelId, setReconnectChannelId] = useState<string | undefined>(undefined);

  // Embedded Signup via Meta's JS SDK: FB.login hands back `code` in its
  // own callback, while the WABA + phone number the user picked inside
  // Meta's popup arrive separately via a WA_EMBEDDED_SIGNUP postMessage.
  // Order between the two isn't guaranteed, so both are buffered in refs
  // (not state — this must read synchronously, no stale-closure risk) and
  // the submit fires once both are present. inFlightRef guards against
  // firing twice if both arrive close together.
  const embeddedSignupCodeRef = useRef<string | null>(null);
  const embeddedSignupTargetRef = useRef<{ wabaId: string; phoneNumberId: string } | null>(null);
  const embeddedSignupInFlightRef = useRef(false);

  const { maxChannels } = usePlanFeatures();
  const atChannelLimit = channels.length >= maxChannels;

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/channels');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed');
      setChannels(data.channels ?? []);
    } catch (err) {
      console.error('[WhatsAppChannelList] fetch error:', err);
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  function openCreateDialog() {
    setTypePickerOpen(true);
  }

  function openEditDialog(channel: WhatsAppChannel) {
    setEditingChannel(channel);
    setDialogOpen(true);
  }

  function openReconnectDialog(channel: WhatsAppChannel) {
    setReconnectChannelId(channel.id);
    setEvolutionDialogOpen(true);
  }

  function handleSelectCloudApi() {
    setTypePickerOpen(false);
    setEditingChannel(null);
    setDialogOpen(true);
  }

  function handleSelectEvolution() {
    setTypePickerOpen(false);
    setReconnectChannelId(undefined);
    setEvolutionDialogOpen(true);
  }

  useEffect(() => {
    loadFacebookSdk();
  }, []);

  // Fires the backend POST once both the `code` (from FB.login's own
  // callback) and the chosen waba/phone number (from the WA_EMBEDDED_SIGNUP
  // postMessage below) have arrived — whichever shows up second triggers it.
  const finishEmbeddedSignup = useCallback(async () => {
    const code = embeddedSignupCodeRef.current;
    const target = embeddedSignupTargetRef.current;
    if (!code || !target || embeddedSignupInFlightRef.current) return;
    embeddedSignupInFlightRef.current = true;
    try {
      const res = await fetch('/api/whatsapp/embedded-signup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, wabaId: target.wabaId, phoneNumberId: target.phoneNumberId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('embeddedSignupFailed'));
        return;
      }
      toast.success(t('embeddedSignupSuccess'));
      await fetchChannels();
    } catch (err) {
      console.error('[WhatsAppChannelList] embedded signup complete error:', err);
      toast.error(t('embeddedSignupFailed'));
    } finally {
      embeddedSignupCodeRef.current = null;
      embeddedSignupTargetRef.current = null;
      embeddedSignupInFlightRef.current = false;
    }
  }, [fetchChannels, t]);

  function handleSelectEmbeddedSignup() {
    setTypePickerOpen(false);
    if (!window.FB) {
      toast.error(t('embeddedSignupFailed'));
      return;
    }
    embeddedSignupCodeRef.current = null;
    embeddedSignupTargetRef.current = null;
    window.FB.login(
      (response: FacebookLoginResponse) => {
        const code = response.authResponse?.code;
        if (!code) return;
        embeddedSignupCodeRef.current = code;
        finishEmbeddedSignup();
      },
      {
        config_id: META_EMBEDDED_SIGNUP_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
      },
    );
  }

  // Meta's Embedded Signup popup posts progress here. Only origins ending
  // in facebook.com are trusted — anything else is ignored outright.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.origin.endsWith('facebook.com')) return;
      let data: { type?: string; event?: string; data?: Record<string, unknown> };
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type !== 'WA_EMBEDDED_SIGNUP') return;

      if (data.event === 'FINISH') {
        const wabaId = data.data?.waba_id as string | undefined;
        const phoneNumberId = data.data?.phone_number_id as string | undefined;
        if (!wabaId || !phoneNumberId) return;
        embeddedSignupTargetRef.current = { wabaId, phoneNumberId };
        finishEmbeddedSignup();
      } else if (data.event === 'CANCEL' || data.event === 'ERROR') {
        console.error('[WhatsAppChannelList] embedded signup', data.event, data.data);
        toast.error(t('embeddedSignupFailed'));
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [finishEmbeddedSignup, t]);

  async function patchChannel(channel: WhatsAppChannel, body: Record<string, unknown>) {
    setBusyId(channel.id);
    try {
      const res = await fetch(`/api/whatsapp/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('saveFailed'));
        return false;
      }
      return true;
    } catch (err) {
      console.error('[WhatsAppChannelList] update error:', err);
      toast.error(t('saveFailed'));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetDefault(channel: WhatsAppChannel) {
    const ok = await patchChannel(channel, { is_default: true });
    if (ok) {
      toast.success(t('setDefaultSuccess'));
      await fetchChannels();
    }
  }

  async function handleToggleActive(channel: WhatsAppChannel) {
    const ok = await patchChannel(channel, { is_active: !channel.is_active });
    if (ok) await fetchChannels();
  }

  async function handleDelete(channel: WhatsAppChannel) {
    if (!confirm(t('deleteConfirm'))) return;
    setBusyId(channel.id);
    try {
      const res = await fetch(`/api/whatsapp/channels/${channel.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('deleteFailed'));
        return;
      }
      toast.success(t('deleteSuccess'));
      await fetchChannels();
    } catch (err) {
      console.error('[WhatsAppChannelList] delete error:', err);
      toast.error(t('deleteFailed'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-foreground">{t('title')}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('description')}
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {atChannelLimit && <UpgradeBadge />}
          <Button
            onClick={openCreateDialog}
            disabled={atChannelLimit}
            title={atChannelLimit ? t('channelLimitReached', { max: maxChannels }) : undefined}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            {t('addButton')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : channels.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {channels.map((channel) => (
              <li
                key={channel.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{channel.name}</span>
                    {channel.is_default && (
                      <Badge className="bg-primary/10 text-primary border-primary/30">
                        {t('defaultBadge')}
                      </Badge>
                    )}
                    <Badge variant={channel.is_active ? 'outline' : 'secondary'}>
                      {channel.is_active ? tCommon('active') : tCommon('inactive')}
                    </Badge>
                    {channel.channel_type === 'evolution' ? (
                      <EvolutionStatusBadge status={channel.evolution_status} t={t} />
                    ) : channel.registered ? (
                      <Badge className="bg-primary/10 text-primary border-primary/30 gap-1">
                        <CheckCircle2 className="size-3" />
                        {t('cloudApiStatusRegistered')}
                      </Badge>
                    ) : (
                      <Badge
                        variant="destructive"
                        className="gap-1"
                        title={channel.last_registration_error ?? undefined}
                      >
                        <AlertTriangle className="size-3" />
                        {t('notRegisteredBadge')}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {channel.channel_type === 'evolution'
                      ? t('evolutionCardTitle')
                      : channel.display_phone_number || channel.phone_number_id}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!channel.is_default && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === channel.id}
                      onClick={() => handleSetDefault(channel)}
                      className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {t('setDefaultButton')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === channel.id}
                    onClick={() => handleToggleActive(channel)}
                    className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {channel.is_active ? t('deactivateButton') : t('activateButton')}
                  </Button>
                  {channel.channel_type === 'evolution' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openReconnectDialog(channel)}
                      className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {t('reconnectButton')}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(channel)}
                      className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {tCommon('edit')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={busyId === channel.id}
                    onClick={() => handleDelete(channel)}
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 size-8"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <WhatsAppChannelTypePicker
        open={typePickerOpen}
        onOpenChange={setTypePickerOpen}
        onSelectEmbeddedSignup={handleSelectEmbeddedSignup}
        onSelectCloudApi={handleSelectCloudApi}
        onSelectEvolution={handleSelectEvolution}
      />

      <WhatsAppChannelFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        channel={editingChannel}
        onSaved={fetchChannels}
      />

      <EvolutionChannelDialog
        open={evolutionDialogOpen}
        onOpenChange={setEvolutionDialogOpen}
        reconnectChannelId={reconnectChannelId}
        onSaved={fetchChannels}
      />
    </Card>
  );
}

function EvolutionStatusBadge({
  status,
  t,
}: {
  status: WhatsAppChannel['evolution_status'];
  t: ReturnType<typeof useTranslations>;
}) {
  if (status === 'open') {
    return (
      <Badge className="bg-primary/10 text-primary border-primary/30 gap-1">
        <CheckCircle2 className="size-3" />
        {t('evolutionStatusOpen')}
      </Badge>
    );
  }
  if (status === 'connecting') {
    return <Badge variant="secondary">{t('evolutionStatusConnecting')}</Badge>;
  }
  // 'close' and the unused-in-practice 'disconnected' default both
  // read as the same "not connected" state to the user.
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="size-3" />
      {t('evolutionStatusClose')}
    </Badge>
  );
}
