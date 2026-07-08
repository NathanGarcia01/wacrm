"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Star } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { NpsSettings } from "@/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * NPS survey settings — one row per account (nps_settings, unique on
 * account_id). Controls whether the post-conversation satisfaction
 * survey fires automatically, after how many idle hours, and the two
 * message templates it sends.
 */
export function NpsSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const t = useTranslations("settings.nps");
  const tCommon = useTranslations("common");
  const defaultMessageTemplate = t("defaultMessageTemplate");
  const defaultFollowUpMessage = t("defaultFollowUpMessage");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [inactivityHours, setInactivityHours] = useState("24");
  const [messageTemplate, setMessageTemplate] = useState(defaultMessageTemplate);
  const [followUpMessage, setFollowUpMessage] = useState(defaultFollowUpMessage);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    supabase
      .from("nps_settings")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const settings = data as NpsSettings | null;
        if (settings) {
          setEnabled(settings.enabled);
          setInactivityHours(String(settings.inactivity_hours));
          setMessageTemplate(settings.message_template);
          setFollowUpMessage(settings.follow_up_message);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  async function handleSave() {
    if (!accountId) return;
    const hours = parseInt(inactivityHours, 10);
    if (!hours || hours < 1) {
      toast.error(t("invalidHours"));
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("nps_settings").upsert(
      {
        account_id: accountId,
        enabled,
        inactivity_hours: hours,
        message_template: messageTemplate.trim() || defaultMessageTemplate,
        follow_up_message: followUpMessage.trim() || defaultFollowUpMessage,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" },
    );
    setSaving(false);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("saved"));
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t("title")}
        description={t("description")}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Star className="size-4 text-primary" />
            {t("cardTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("cardDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("enableLabel")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("enableHint")}
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(v) => setEnabled(!!v)}
                  disabled={!canEditSettings}
                  aria-label={t("enableLabel")}
                />
              </div>

              <div className="grid gap-2 sm:max-w-xs">
                <Label className="text-muted-foreground">
                  {t("inactivityHoursLabel")}
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={inactivityHours}
                  onChange={(e) => setInactivityHours(e.target.value)}
                  disabled={!canEditSettings}
                  className="border-border bg-muted text-foreground"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("surveyMessageLabel")}</Label>
                <Textarea
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                  disabled={!canEditSettings}
                  className="min-h-[90px] border-border bg-muted text-foreground"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("followUpMessageLabel")}</Label>
                <Textarea
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  disabled={!canEditSettings}
                  className="min-h-[70px] border-border bg-muted text-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {t("followUpHint")}
                </p>
              </div>

              {!canEditSettings && (
                <p className="text-xs text-muted-foreground">
                  {t("adminOnlyHint")}
                </p>
              )}

              {canEditSettings && (
                <Button
                  onClick={handleSave}
                  disabled={saving || profileLoading}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {t("saving")}
                    </>
                  ) : (
                    tCommon("save")
                  )}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
