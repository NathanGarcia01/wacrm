'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { WhatsAppChannel } from './whatsapp-channel-list';

const MASKED_TOKEN = '••••••••••••••••';

interface WhatsAppChannelFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create a new channel. */
  channel: WhatsAppChannel | null;
  onSaved: () => void;
}

export function WhatsAppChannelFormDialog({
  open,
  onOpenChange,
  channel,
  onSaved,
}: WhatsAppChannelFormDialogProps) {
  const t = useTranslations('settings.whatsapp');
  const tChannels = useTranslations('settings.whatsapp.channels');
  const tCommon = useTranslations('common');

  const [name, setName] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [tokenEdited, setTokenEdited] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Re-seed the form every time the dialog opens (or the target channel
  // changes) rather than on mount — the same dialog instance is reused
  // for every "Editar" click from the list.
  useEffect(() => {
    if (!open) return;
    if (channel) {
      setName(channel.name);
      setPhoneNumberId(channel.phone_number_id);
      setWabaId(channel.waba_id ?? '');
      setAccessToken(MASKED_TOKEN);
      setVerifyToken('');
      setPin('');
      setMakeDefault(channel.is_default);
      setTokenEdited(false);
    } else {
      setName('');
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setVerifyToken('');
      setPin('');
      setMakeDefault(false);
      setTokenEdited(false);
    }
    setShowToken(false);
  }, [open, channel]);

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error(tChannels('nameRequired'));
      return;
    }
    if (!phoneNumberId.trim()) {
      toast.error(t('phoneIdRequired'));
      return;
    }
    if (!channel && (!tokenEdited || !accessToken.trim())) {
      toast.error(t('tokenRequiredInitial'));
      return;
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      phone_number_id: phoneNumberId.trim(),
      waba_id: wabaId.trim() || null,
      verify_token: verifyToken.trim() || null,
      pin: pin.trim() || null,
      is_default: makeDefault,
    };
    if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
      payload.access_token = accessToken.trim();
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        channel ? `/api/whatsapp/channels/${channel.id}` : '/api/whatsapp/channels',
        {
          method: channel ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || tChannels('saveFailed'));
        setSubmitting(false);
        return;
      }

      if (data.registration_error) {
        toast.error(
          t('savedButRegistrationFailed', { error: data.registration_error }),
          { duration: 12000 },
        );
      } else {
        toast.success(channel ? tChannels('updatedSuccess') : tChannels('createdSuccess'));
      }

      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error('[WhatsAppChannelFormDialog] save error:', err);
      toast.error(tChannels('saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {channel ? tChannels('dialogEditTitle') : tChannels('dialogAddTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {tChannels('dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-muted-foreground">{tChannels('nameLabel')}</Label>
            <Input
              placeholder={tChannels('namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('phoneNumberIdLabel')}</Label>
            <Input
              placeholder={t('phoneNumberIdPlaceholder')}
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('wabaIdLabel')}</Label>
            <Input
              placeholder={t('wabaIdPlaceholder')}
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('accessTokenLabel')}</Label>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                placeholder={t('accessTokenPlaceholder')}
                value={accessToken}
                onChange={(e) => {
                  setAccessToken(e.target.value);
                  setTokenEdited(true);
                }}
                onFocus={() => {
                  if (accessToken === MASKED_TOKEN) {
                    setAccessToken('');
                    setTokenEdited(true);
                  }
                }}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {channel && !tokenEdited && (
              <p className="text-xs text-muted-foreground">{t('tokenHiddenHint')}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('verifyTokenLabel')}</Label>
            <Input
              placeholder={t('verifyTokenPlaceholder')}
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">
              {t('pinLabel')}
              <span className="ml-1 text-muted-foreground">({tCommon('optional')})</span>
            </Label>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder={t('pinPlaceholder')}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground tracking-widest"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2.5">
            <div className="space-y-0.5">
              <Label className="text-foreground">{tChannels('makeDefaultLabel')}</Label>
              <p className="text-xs text-muted-foreground">{tChannels('makeDefaultHint')}</p>
            </div>
            <Switch checked={makeDefault} onCheckedChange={setMakeDefault} />
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {tCommon('cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {tCommon('save')}...
              </>
            ) : (
              tCommon('save')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
