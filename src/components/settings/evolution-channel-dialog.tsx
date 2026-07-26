'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, QrCode, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const POLL_INTERVAL_MS = 3000;
const QR_TIMEOUT_MS = 2 * 60 * 1000;

type Step = 'name' | 'qrcode' | 'connected' | 'timeout';

interface EvolutionChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing channel to reconnect — skips straight to fetching a
   *  fresh QR code, no name step. Undefined = creating a brand-new
   *  channel. */
  reconnectChannelId?: string;
  onSaved: () => void;
}

export function EvolutionChannelDialog({
  open,
  onOpenChange,
  reconnectChannelId,
  onSaved,
}: EvolutionChannelDialogProps) {
  const t = useTranslations('settings.whatsapp.channels');
  const tCommon = useTranslations('common');

  const [step, setStep] = useState<Step>(reconnectChannelId ? 'qrcode' : 'name');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(reconnectChannelId ?? null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
  }, []);

  // Reset to the right starting step every time the dialog opens —
  // same "re-seed on open" pattern as WhatsAppChannelFormDialog.
  useEffect(() => {
    if (!open) {
      clearTimers();
      return;
    }
    setName('');
    setQrCode(null);
    setChannelId(reconnectChannelId ?? null);
    setStep(reconnectChannelId ? 'qrcode' : 'name');
  }, [open, reconnectChannelId, clearTimers]);

  const startPolling = useCallback(
    (id: string) => {
      clearTimers();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/whatsapp/channels/${id}/evolution-status`);
          const data = await res.json();
          if (res.ok && data.evolution_status === 'open') {
            clearTimers();
            setStep('connected');
          }
        } catch {
          // Transient network hiccup — next tick tries again.
        }
      }, POLL_INTERVAL_MS);
      timeoutRef.current = setTimeout(() => {
        clearTimers();
        setStep((current) => (current === 'connected' ? current : 'timeout'));
      }, QR_TIMEOUT_MS);
    },
    [clearTimers],
  );

  async function handleCreate() {
    if (!name.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/whatsapp/channels/evolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('evolutionCreateFailed'));
        return;
      }
      setChannelId(data.channel.id);
      setQrCode(data.qr_code_base64 ?? null);
      if (!data.qr_code_base64) {
        toast.error(data.qr_error || t('evolutionQrLoadFailed'));
      }
      setStep('qrcode');
      startPolling(data.channel.id);
    } catch (err) {
      console.error('[EvolutionChannelDialog] create error:', err);
      toast.error(t('evolutionCreateFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const fetchFreshQrCode = useCallback(
    async (id: string) => {
      setSubmitting(true);
      try {
        const res = await fetch(`/api/whatsapp/channels/${id}/evolution-qrcode`, {
          method: 'POST',
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || t('evolutionQrLoadFailed'));
          return;
        }
        setQrCode(data.qr_code_base64 ?? null);
        setStep('qrcode');
        startPolling(id);
      } catch (err) {
        console.error('[EvolutionChannelDialog] qrcode error:', err);
        toast.error(t('evolutionQrLoadFailed'));
      } finally {
        setSubmitting(false);
      }
    },
    [startPolling, t],
  );

  // Reconnect mode: fetch the first QR as soon as the dialog opens,
  // instead of waiting for a "create" click that doesn't apply here.
  useEffect(() => {
    if (open && reconnectChannelId && step === 'qrcode' && !qrCode) {
      fetchFreshQrCode(reconnectChannelId);
    }
    // Only on open/channel change — fetchFreshQrCode/step/qrCode
    // intentionally excluded to avoid re-fetching on every state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reconnectChannelId]);

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) clearTimers();
    onOpenChange(nextOpen);
    // Refresh the list whenever we're closing after a channel actually
    // exists server-side — covers both "connected" and "closed mid-QR"
    // (the row was already created before the QR ever rendered, so the
    // list should pick it up as pending even if the user bails early).
    if (!nextOpen && channelId) onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-popover border-border sm:max-w-sm">
        {step === 'name' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {t('evolutionDialogTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('evolutionCardDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label className="text-muted-foreground">{t('evolutionNameLabel')}</Label>
              <Input
                autoFocus
                placeholder={t('evolutionNamePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <DialogFooter className="bg-popover border-border">
              <Button
                variant="outline"
                onClick={() => handleClose(false)}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {tCommon('cancel')}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={submitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {t('evolutionCreateButton')}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'qrcode' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-popover-foreground">
                <QrCode className="size-5" />
                {t('evolutionQrTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('evolutionQrHint')}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-4">
              {qrCode ? (
                // eslint-disable-next-line @next/next/no-img-element -- data-URI QR, not an optimizable asset
                <img
                  src={qrCode}
                  alt={t('evolutionQrTitle')}
                  className="size-64 rounded-lg border border-border bg-white p-2"
                />
              ) : (
                <div className="flex size-64 items-center justify-center rounded-lg border border-border bg-muted/30">
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            <DialogFooter className="bg-popover border-border">
              <Button
                variant="outline"
                onClick={() => handleClose(false)}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {tCommon('close')}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'connected' && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="size-12 text-primary" />
            <p className="text-lg font-medium text-foreground">{t('evolutionConnectedTitle')}</p>
            <Button
              onClick={() => handleClose(false)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {tCommon('done')}
            </Button>
          </div>
        )}

        {step === 'timeout' && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <p className="text-lg font-medium text-foreground">{t('evolutionTimeoutTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('evolutionTimeoutHint')}</p>
            <Button
              onClick={() => channelId && fetchFreshQrCode(channelId)}
              disabled={submitting || !channelId}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCw className="size-4" />
              )}
              {t('evolutionRegenerateButton')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
