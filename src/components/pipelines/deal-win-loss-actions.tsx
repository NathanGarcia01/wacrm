"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import type { Deal, DealLossReason } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { fireAutomationTrigger } from "@/lib/automations/client-dispatch";

const LOST_REASON_CHIPS = ["priceTooHigh", "choseCompetitor", "noInterest", "noContact", "other"] as const;

/**
 * Fase 6, Etapa 1 — Ganhar/Perder no painel de detalhe do negócio.
 * Mesma persistência exata de deal-form.tsx's handleStatusChange/
 * confirmMarkLost (migration 084's lost_reason_id) — reescrito como
 * componente próprio porque o bloco original só renderizava com
 * `deal &&`, inalcançável agora que o Sheet é só de criação.
 */
export function DealWinLossActions({
  deal,
  onChanged,
}: {
  deal: Deal;
  onChanged: () => void;
}) {
  const t = useTranslations("pipelines.dealForm");
  const supabase = createClient();

  const [statusSaving, setStatusSaving] = useState<"won" | "open" | null>(null);
  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostReasonId, setLostReasonId] = useState<string | null>(null);
  const [savingLost, setSavingLost] = useState(false);
  const [customLossReasons, setCustomLossReasons] = useState<DealLossReason[]>([]);

  useEffect(() => {
    if (!lostDialogOpen) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("deal_loss_reasons")
        .select("*")
        .eq("is_active", true)
        .order("position");
      if (!cancelled) setCustomLossReasons((data ?? []) as DealLossReason[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [lostDialogOpen, supabase]);

  const lossReasonChips: { key: string; label: string; reasonId?: string; isOther?: boolean }[] =
    customLossReasons.length > 0
      ? [
          ...customLossReasons.map((r) => ({ key: r.id, label: r.label, reasonId: r.id })),
          { key: "__other__", label: t("lostReasonChips.other"), isOther: true },
        ]
      : LOST_REASON_CHIPS.map((key) => ({ key, label: t(`lostReasonChips.${key}`), isOther: key === "other" }));

  function handleReasonChip(chip: { label: string; reasonId?: string; isOther?: boolean }) {
    setLostReason(chip.isOther ? "" : chip.label);
    setLostReasonId(chip.reasonId ?? null);
  }

  async function handleMarkWon() {
    setStatusSaving("won");
    const { error } = await supabase.from("deals").update({ status: "won" }).eq("id", deal.id);
    setStatusSaving(null);
    if (error) {
      toast.error(t("updateStatusFailed"));
      return;
    }
    fireAutomationTrigger("deal_won", deal.contact_id);
    toast.success(t("markedAsWon"));
    onChanged();
  }

  async function handleReopen() {
    setStatusSaving("open");
    const { error } = await supabase.from("deals").update({ status: "open" }).eq("id", deal.id);
    setStatusSaving(null);
    if (error) {
      toast.error(t("updateStatusFailed"));
      return;
    }
    toast.success(t("dealReopened"));
    onChanged();
  }

  async function confirmMarkLost() {
    if (!lostReason.trim()) return;
    setSavingLost(true);
    const { error } = await supabase
      .from("deals")
      .update({ status: "lost", lost_reason: lostReason.trim(), lost_reason_id: lostReasonId })
      .eq("id", deal.id);
    setSavingLost(false);
    if (error) {
      toast.error(t("updateStatusFailed"));
      return;
    }
    fireAutomationTrigger("deal_lost", deal.contact_id, { vars: { reason: lostReason.trim() } });
    toast.success(t("markedAsLost"));
    setLostDialogOpen(false);
    setLostReason("");
    setLostReasonId(null);
    onChanged();
  }

  if (deal.status === "won" || deal.status === "lost") {
    return (
      <Button variant="outline" size="sm" onClick={handleReopen} disabled={statusSaving !== null} className="border-border">
        {statusSaving === "open" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        {t("reopenDeal")}
      </Button>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={handleMarkWon}
          disabled={statusSaving !== null}
          className="min-w-[140px] flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {statusSaving === "won" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t("markAsWon")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setLostDialogOpen(true)}
          disabled={statusSaving !== null}
          className="min-w-[140px] flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          <X className="h-3.5 w-3.5" />
          {t("markAsLost")}
        </Button>
      </div>

      <Dialog open={lostDialogOpen} onOpenChange={setLostDialogOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("lostReasonTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {lossReasonChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => handleReasonChip(chip)}
                className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground hover:border-primary hover:text-primary"
              >
                {chip.label}
              </button>
            ))}
          </div>
          <Textarea
            value={lostReason}
            onChange={(e) => {
              setLostReason(e.target.value);
              setLostReasonId(null);
            }}
            placeholder={t("lostReasonPlaceholder")}
            className="min-h-[80px] border-border bg-muted text-foreground"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLostDialogOpen(false)}
              disabled={savingLost}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button type="button" onClick={confirmMarkLost} disabled={savingLost || !lostReason.trim()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {savingLost ? <Loader2 className="h-4 w-4 animate-spin" /> : t("markAsLost")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
