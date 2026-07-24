"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Coins, Loader2, Plus, TrendingDown, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import type { DealLossReason } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Deals settings — account-wide default currency.
 *
 * One currency per account (issue #218): the chosen code seeds new
 * deals and formats every aggregated total. Existing deals keep their
 * own saved currency. Writes go straight to `accounts.default_currency`;
 * the `accounts_update` RLS policy (017) already restricts that to
 * admins+, so non-admins see a disabled, read-only control.
 */
export function DealsSettings() {
  const supabase = createClient();
  const t = useTranslations('settings.deals');
  const tCommon = useTranslations('common');
  const tCurrencies = useTranslations('currencies');
  const {
    accountId,
    defaultCurrency,
    canEditSettings,
    profileLoading,
    refreshProfile,
  } = useAuth();

  const [selected, setSelected] = useState(defaultCurrency);
  const [saving, setSaving] = useState(false);

  // Keep the select in sync once the profile (and its account default)
  // resolves, and after a save round-trips through refreshProfile.
  useEffect(() => {
    setSelected(defaultCurrency);
  }, [defaultCurrency]);

  const dirty = selected !== defaultCurrency;

  async function handleSave() {
    if (!accountId || !dirty) return;
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({ default_currency: selected })
      .eq("id", accountId);
    if (error) {
      toast.error(t('saveFailed'));
      setSaving(false);
      return;
    }
    // Pull the new value back into the auth context so the deal form
    // and every total pick it up without a full reload.
    await refreshProfile();
    setSaving(false);
    toast.success(t('saved'));
  }

  // ---- Loss reasons (quick-fill chips in the deal-lost dialog) ----
  const [reasons, setReasons] = useState<DealLossReason[]>([]);
  const [reasonsLoading, setReasonsLoading] = useState(true);
  const [newReason, setNewReason] = useState("");
  const [addingReason, setAddingReason] = useState(false);
  const [busyReasonId, setBusyReasonId] = useState<string | null>(null);

  const fetchReasons = useCallback(async () => {
    if (!accountId) return;
    setReasonsLoading(true);
    const { data } = await supabase
      .from("deal_loss_reasons")
      .select("*")
      .order("position")
      .order("created_at");
    setReasons((data as DealLossReason[] | null) ?? []);
    setReasonsLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchReasons();
    }
  }, [accountId, fetchReasons]);

  async function handleAddReason() {
    const label = newReason.trim();
    if (!label || !accountId) return;
    setAddingReason(true);
    const { error } = await supabase
      .from("deal_loss_reasons")
      .insert({ account_id: accountId, label, position: reasons.length });
    setAddingReason(false);
    if (error) {
      toast.error(t('reasonAddFailed'));
      return;
    }
    setNewReason("");
    await fetchReasons();
  }

  async function handleDeleteReason(reason: DealLossReason) {
    setBusyReasonId(reason.id);
    const { error } = await supabase
      .from("deal_loss_reasons")
      .delete()
      .eq("id", reason.id);
    setBusyReasonId(null);
    if (error) {
      toast.error(t('reasonDeleteFailed'));
      return;
    }
    setReasons((prev) => prev.filter((r) => r.id !== reason.id));
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Coins className="size-4 text-primary" />
            {t('defaultCurrency')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('defaultCurrencyDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label className="text-muted-foreground">{t('currencyLabel')}</Label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!canEditSettings || profileLoading}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {tCurrencies(c.code)}
                </option>
              ))}
            </select>
            {!canEditSettings && (
              <p className="text-xs text-muted-foreground">
                {t('adminOnlyHint')}
              </p>
            )}
          </div>

          {canEditSettings && (
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                tCommon('save')
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <TrendingDown className="size-4 text-primary" />
            {t('lossReasonsTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('lossReasonsDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEditSettings && (
            <div className="flex gap-2">
              <Input
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddReason();
                  }
                }}
                placeholder={t('lossReasonPlaceholder')}
                className="border-border bg-muted text-foreground"
              />
              <Button
                onClick={handleAddReason}
                disabled={addingReason || !newReason.trim()}
                className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {addingReason ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="size-4" />
                    {tCommon('add')}
                  </>
                )}
              </Button>
            </div>
          )}

          {reasonsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : reasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('lossReasonsEmpty')}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {reasons.map((reason) => (
                <li
                  key={reason.id}
                  className="group flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-foreground"
                >
                  {reason.label}
                  {canEditSettings && (
                    <button
                      type="button"
                      onClick={() => handleDeleteReason(reason)}
                      disabled={busyReasonId === reason.id}
                      aria-label={t('lossReasonDeleteAria', { label: reason.label })}
                      className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                    >
                      {busyReasonId === reason.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <X className="size-3" />
                      )}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!canEditSettings && (
            <p className="text-xs text-muted-foreground">{t('adminOnlyHint')}</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
