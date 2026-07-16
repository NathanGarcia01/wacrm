'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { WhatsAppChannelFormDialog } from './whatsapp-channel-form-dialog';

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
    setEditingChannel(null);
    setDialogOpen(true);
  }

  function openEditDialog(channel: WhatsAppChannel) {
    setEditingChannel(channel);
    setDialogOpen(true);
  }

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
        <Button
          onClick={openCreateDialog}
          className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
        >
          <Plus className="size-4" />
          {t('addButton')}
        </Button>
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
                    {!channel.registered && (
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
                    {channel.display_phone_number || channel.phone_number_id}
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(channel)}
                    className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {tCommon('edit')}
                  </Button>
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

      <WhatsAppChannelFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        channel={editingChannel}
        onSaved={fetchChannels}
      />
    </Card>
  );
}
