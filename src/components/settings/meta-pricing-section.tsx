'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { DollarSign, Info, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface MetaPricingData {
  marketing_cost: number;
  utility_cost: number;
  authentication_cost: number;
}

/**
 * Manual entry for the account's Meta per-message rates, used to
 * compute broadcast ROI (see meta-cost.ts). A "check billing model"
 * button probes Meta's `pricing_model` field as a courtesy — Meta
 * doesn't expose the actual R$/category rate card via API, only
 * whether the number is on old (CBP) or current (PMP) billing, so
 * this can't auto-fill the fields below; manual entry is the only
 * reliable path (see getPricingModel's doc comment in meta-api.ts).
 */
export function MetaPricingSection() {
  const t = useTranslations('settings.whatsapp.metaPricing');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingModel, setCheckingModel] = useState(false);
  const [pricingModel, setPricingModel] = useState<string | null>(null);
  const [marketingCost, setMarketingCost] = useState('0');
  const [utilityCost, setUtilityCost] = useState('0');
  const [authenticationCost, setAuthenticationCost] = useState('0');

  const applyPricing = useCallback((pricing: MetaPricingData | null) => {
    setMarketingCost(String(pricing?.marketing_cost ?? 0));
    setUtilityCost(String(pricing?.utility_cost ?? 0));
    setAuthenticationCost(String(pricing?.authentication_cost ?? 0));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/meta-pricing');
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        applyPricing(payload.pricing ?? null);
        setPricingModel(payload.pricingModel ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [applyPricing]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCheckModel() {
    setCheckingModel(true);
    try {
      const res = await fetch('/api/whatsapp/meta-pricing');
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        setPricingModel(payload.pricingModel ?? null);
        toast.success(t('checkModelDone'));
      } else {
        toast.error(t('checkModelFailed'));
      }
    } finally {
      setCheckingModel(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp/meta-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country_code: 'BR',
          marketing_cost: Number(marketingCost) || 0,
          utility_cost: Number(utilityCost) || 0,
          authentication_cost: Number(authenticationCost) || 0,
        }),
      });
      if (!res.ok) {
        toast.error(t('saveFailed'));
        return;
      }
      toast.success(t('saved'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground text-base">
          <DollarSign className="size-4 text-gold" />
          {t('title')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-muted/50 border-border">
          <Info className="size-4 text-muted-foreground" />
          <AlertDescription className="text-muted-foreground text-xs">
            {t('apiLimitationHint')}
          </AlertDescription>
        </Alert>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {pricingModel
              ? t('billingModelKnown', { model: pricingModel })
              : t('billingModelUnknown')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCheckModel}
            disabled={checkingModel}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {checkingModel ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {t('checkModelButton')}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs">{t('marketingLabel')}</Label>
              <Input
                type="number"
                min="0"
                step="0.0001"
                value={marketingCost}
                onChange={(e) => setMarketingCost(e.target.value)}
                className="bg-muted border-border text-foreground font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs">{t('utilityLabel')}</Label>
              <Input
                type="number"
                min="0"
                step="0.0001"
                value={utilityCost}
                onChange={(e) => setUtilityCost(e.target.value)}
                className="bg-muted border-border text-foreground font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs">{t('authenticationLabel')}</Label>
              <Input
                type="number"
                min="0"
                step="0.0001"
                value={authenticationCost}
                onChange={(e) => setAuthenticationCost(e.target.value)}
                className="bg-muted border-border text-foreground font-mono"
              />
            </div>
          </div>
        )}

        <Button
          onClick={handleSave}
          disabled={saving || loading}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {saving ? t('saving') : t('save')}
        </Button>
      </CardContent>
    </Card>
  );
}
