"use client";

import { useEffect, useState } from "react";
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

const DEFAULT_MESSAGE_TEMPLATE =
  "Olá! Como você avalia o atendimento que recebeu? Responda com um número de 1 a 5, onde 1 = Péssimo e 5 = Excelente. 😊";
const DEFAULT_FOLLOW_UP_MESSAGE =
  "Obrigado pela sua avaliação! Tem algum comentário adicional? (opcional)";

/**
 * NPS survey settings — one row per account (nps_settings, unique on
 * account_id). Controls whether the post-conversation satisfaction
 * survey fires automatically, after how many idle hours, and the two
 * message templates it sends.
 */
export function NpsSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [inactivityHours, setInactivityHours] = useState("24");
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_MESSAGE_TEMPLATE);
  const [followUpMessage, setFollowUpMessage] = useState(DEFAULT_FOLLOW_UP_MESSAGE);

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
      toast.error("Informe um número de horas válido.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("nps_settings").upsert(
      {
        account_id: accountId,
        enabled,
        inactivity_hours: hours,
        message_template: messageTemplate.trim() || DEFAULT_MESSAGE_TEMPLATE,
        follow_up_message: followUpMessage.trim() || DEFAULT_FOLLOW_UP_MESSAGE,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" },
    );
    setSaving(false);
    if (error) {
      toast.error("Falha ao salvar configurações de NPS");
      return;
    }
    toast.success("Configurações de NPS salvas");
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Satisfação (NPS)"
        description="Pesquisa automática de satisfação enviada por WhatsApp após o atendimento."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Star className="size-4 text-primary" />
            Pesquisa de satisfação
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Quando ativada, o cliente recebe uma pergunta de 1 a 5 estrelas ao fim do
            atendimento — manualmente (ao fechar a conversa) ou após um período de
            inatividade.
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
                    Ativar pesquisa de satisfação automática
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Dispara ao fechar uma conversa e após inatividade.
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(v) => setEnabled(!!v)}
                  disabled={!canEditSettings}
                  aria-label="Ativar pesquisa de satisfação automática"
                />
              </div>

              <div className="grid gap-2 sm:max-w-xs">
                <Label className="text-muted-foreground">
                  Disparar também após X horas de inatividade
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
                <Label className="text-muted-foreground">Mensagem da pesquisa</Label>
                <Textarea
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                  disabled={!canEditSettings}
                  className="min-h-[90px] border-border bg-muted text-foreground"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">Mensagem de follow-up</Label>
                <Textarea
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  disabled={!canEditSettings}
                  className="min-h-[70px] border-border bg-muted text-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Enviada depois que o cliente responde com a nota, pedindo um
                  comentário opcional.
                </p>
              </div>

              {!canEditSettings && (
                <p className="text-xs text-muted-foreground">
                  Apenas administradores da conta podem alterar essas configurações.
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
                      Salvando...
                    </>
                  ) : (
                    "Salvar"
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
