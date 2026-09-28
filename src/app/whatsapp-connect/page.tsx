'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CheckCircle2, Copy, Eye, EyeOff, Loader2, MessageCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

const POST_MESSAGE_SOURCE = 'funilly-whatsapp-embedded-signup';

interface PhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;
  alreadyConnected: boolean;
}

interface Waba {
  id: string;
  name: string;
  phoneNumbers: PhoneNumber[];
}

type ErrorCode =
  | 'meta_denied'
  | 'missing_params'
  | 'invalid_state'
  | 'no_numbers'
  | 'meta_api_failed'
  | 'session_load_failed'
  | 'complete_failed';

function notifyOpenerAndClose(status: 'success' | 'error', extra?: Record<string, unknown>) {
  window.opener?.postMessage({ source: POST_MESSAGE_SOURCE, status, ...extra }, window.location.origin);
  window.close();
}

export default function WhatsAppConnectPage() {
  return (
    <Suspense fallback={<CenteredState><Loader2 className="size-6 animate-spin text-primary" /></CenteredState>}>
      <WhatsAppConnectContent />
    </Suspense>
  );
}

function WhatsAppConnectContent() {
  const searchParams = useSearchParams();
  const t = useTranslations('settings.whatsapp.channels');
  const tCommon = useTranslations('common');

  const sessionId = searchParams.get('session');
  const urlError = searchParams.get('error') as ErrorCode | null;

  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(urlError);
  const [wabas, setWabas] = useState<Waba[]>([]);
  const [selected, setSelected] = useState<{ wabaId: string; phoneNumberId: string } | null>(null);
  const [channelName, setChannelName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [successPin, setSuccessPin] = useState<string | null>(null);
  const [showPin, setShowPin] = useState(false);

  useEffect(() => {
    if (urlError) {
      setLoading(false);
      return;
    }
    if (!sessionId) {
      setErrorCode('missing_params');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/whatsapp/embedded-signup/session/${sessionId}`);
        const data = await res.json();
        if (!res.ok) {
          setErrorCode('session_load_failed');
          return;
        }
        setWabas(data.wabas ?? []);
        const firstAvailable = (data.wabas ?? []).find((w: Waba) =>
          w.phoneNumbers.some((p) => !p.alreadyConnected),
        );
        const firstNumber = firstAvailable?.phoneNumbers.find((p: PhoneNumber) => !p.alreadyConnected);
        if (firstAvailable && firstNumber) {
          setSelected({ wabaId: firstAvailable.id, phoneNumberId: firstNumber.id });
          setChannelName(firstNumber.verified_name || firstNumber.display_phone_number);
        }
      } catch (err) {
        console.error('[whatsapp-connect] session load error:', err);
        setErrorCode('session_load_failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId, urlError]);

  const handleSelect = useCallback((wabaId: string, phone: PhoneNumber) => {
    if (phone.alreadyConnected) return;
    setSelected({ wabaId, phoneNumberId: phone.id });
    setChannelName(phone.verified_name || phone.display_phone_number);
  }, []);

  async function handleConnect() {
    if (!selected || !sessionId) return;
    setConnecting(true);
    try {
      const res = await fetch('/api/whatsapp/embedded-signup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: sessionId,
          wabaId: selected.wabaId,
          phoneNumberId: selected.phoneNumberId,
          name: channelName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('embeddedSignupErrorGeneric'));
        setConnecting(false);
        return;
      }
      setSuccessPin(data.pin);
      notifyOpenerAndClose('success', { channelId: data.channel?.id });
    } catch (err) {
      console.error('[whatsapp-connect] complete error:', err);
      setErrorCode('complete_failed');
    } finally {
      setConnecting(false);
    }
  }

  function handleRetry() {
    window.location.href = '/api/whatsapp/embedded-signup/connect';
  }

  function handleCloseWithError() {
    notifyOpenerAndClose('error');
  }

  function handleCopyPin() {
    if (!successPin) return;
    navigator.clipboard.writeText(successPin);
    toast.success(tCommon('copy'));
  }

  if (loading) {
    return (
      <CenteredState>
        <Loader2 className="size-6 animate-spin text-primary" />
        <p className="mt-3 text-sm text-muted-foreground">{tCommon('loading')}...</p>
      </CenteredState>
    );
  }

  if (errorCode) {
    const messageKey: Record<ErrorCode, string> = {
      meta_denied: 'embeddedSignupErrorDenied',
      missing_params: 'embeddedSignupErrorInvalidState',
      invalid_state: 'embeddedSignupErrorInvalidState',
      no_numbers: 'embeddedSignupErrorNoNumbers',
      meta_api_failed: 'embeddedSignupErrorGeneric',
      session_load_failed: 'embeddedSignupErrorInvalidState',
      complete_failed: 'embeddedSignupErrorGeneric',
    };
    return (
      <CenteredState>
        <p className="text-sm text-foreground">{t(messageKey[errorCode])}</p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={handleCloseWithError} className="border-border text-muted-foreground">
            {tCommon('close')}
          </Button>
          <Button onClick={handleRetry} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            {t('embeddedSignupRetry')}
          </Button>
        </div>
      </CenteredState>
    );
  }

  if (successPin) {
    return (
      <CenteredState>
        <CheckCircle2 className="size-10 text-primary" />
        <p className="mt-3 text-base font-medium text-foreground">{t('embeddedSignupSuccess')}</p>

        <div className="mt-4 w-full max-w-xs space-y-2 text-left">
          <Label className="text-muted-foreground">{t('embeddedSignupPinLabel')}</Label>
          <div className="relative">
            <Input
              readOnly
              type={showPin ? 'text' : 'password'}
              value={successPin}
              className="bg-muted border-border text-foreground pr-16 tracking-widest"
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
              <button
                type="button"
                onClick={handleCopyPin}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Copy className="size-4" />
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('embeddedSignupPinWarning')}</p>
        </div>

        <Button
          onClick={() => notifyOpenerAndClose('success')}
          className="mt-5 bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {t('embeddedSignupClose')}
        </Button>
      </CenteredState>
    );
  }

  const hasAnyAvailable = wabas.some((w) => w.phoneNumbers.some((p) => !p.alreadyConnected));

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col p-6">
      <div className="mb-4 flex items-center gap-2">
        <MessageCircle className="size-5 text-primary" />
        <h1 className="text-base font-medium text-foreground">{t('embeddedSignupTitle')}</h1>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{t('embeddedSignupDescription')}</p>

      {!hasAnyAvailable ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('embeddedSignupNoAvailableNumbers')}</p>
      ) : (
        <div className="flex-1 space-y-5 overflow-y-auto">
          {wabas.map((waba) => (
            <div key={waba.id}>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{waba.name}</p>
              <div className="space-y-2">
                {waba.phoneNumbers.map((phone) => {
                  const isSelected = selected?.phoneNumberId === phone.id;
                  return (
                    <button
                      key={phone.id}
                      type="button"
                      disabled={phone.alreadyConnected}
                      onClick={() => handleSelect(waba.id, phone)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors ${
                        phone.alreadyConnected
                          ? 'cursor-not-allowed border-border bg-muted/20 opacity-60'
                          : isSelected
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-muted/30 hover:border-primary/50'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{phone.display_phone_number}</p>
                        {phone.verified_name && (
                          <p className="truncate text-xs text-muted-foreground">{phone.verified_name}</p>
                        )}
                      </div>
                      {phone.alreadyConnected && (
                        <Badge variant="secondary" className="shrink-0">
                          {t('embeddedSignupAlreadyConnected')}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {selected && (
            <div className="space-y-2 pt-2">
              <Label className="text-muted-foreground">{t('embeddedSignupChannelNameLabel')}</Label>
              <Input
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
          )}
        </div>
      )}

      <Button
        onClick={handleConnect}
        disabled={!selected || connecting}
        className="mt-5 bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {connecting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {tCommon('loading')}...
          </>
        ) : (
          t('embeddedSignupConnectButton')
        )}
      </Button>
    </div>
  );
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">{children}</div>
  );
}
