"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { toast } from "sonner";
import type { BlockedPhone } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Ban, Loader2 } from "lucide-react";

/**
 * Fase 5 (opt-out de marketing) / Fase 6 Etapa 3 — extraído de
 * contact-sidebar.tsx pra ser reaproveitado também no painel de
 * negócio (deal-detail-panel.tsx), sem duplicar a lógica de
 * busca/liberação. Usa as mesmas chaves i18n já existentes em
 * inbox.sidebar.optOutBanner / settings.optOut.blockedPhones.
 */
export function OptOutBanner({ phone }: { phone: string | null | undefined }) {
  const t = useTranslations("inbox.sidebar");
  const tOptOut = useTranslations("settings.optOut.blockedPhones");
  const { user } = useAuth();
  const canManageOptOut = useCan("edit-settings");

  const [blockedPhone, setBlockedPhone] = useState<BlockedPhone | null>(null);
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [releaseReason, setReleaseReason] = useState(() => t("optOutBanner.releaseReasonDefault"));
  const [releasing, setReleasing] = useState(false);

  const fetchBlocked = useCallback(async () => {
    if (!phone) {
      setBlockedPhone(null);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("blocked_phones")
      .select("*")
      .eq("phone_normalized", phone.replace(/\D/g, ""))
      .is("unblocked_at", null)
      .maybeSingle();
    setBlockedPhone((data as BlockedPhone | null) ?? null);
  }, [phone]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchBlocked();
  }, [fetchBlocked]);

  const handleRelease = useCallback(async () => {
    if (!blockedPhone || !releaseReason.trim()) return;
    setReleasing(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("blocked_phones")
      .update({
        unblocked_at: new Date().toISOString(),
        unblocked_by: user?.id ?? null,
        unblock_reason: releaseReason.trim(),
      })
      .eq("id", blockedPhone.id);
    setReleasing(false);
    if (error) {
      toast.error(t("optOutBanner.releaseFailed"));
      return;
    }
    toast.success(t("optOutBanner.releaseSuccess"));
    setReleaseDialogOpen(false);
    setBlockedPhone(null);
  }, [blockedPhone, releaseReason, user, t]);

  if (!blockedPhone) return null;

  return (
    <>
      <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
        <div className="flex items-start gap-2">
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1 space-y-1 text-xs">
            <p className="font-medium text-destructive">{t("optOutBanner.title")}</p>
            <p className="text-destructive/80">
              {t("optOutBanner.blockedOn", { date: format(new Date(blockedPhone.blocked_at), "dd/MM/yyyy") })}
              {" · "}
              {tOptOut(`sourceLabels.${blockedPhone.source}`)}
            </p>
            {blockedPhone.reason && <p className="text-destructive/80">{blockedPhone.reason}</p>}
          </div>
        </div>
        {canManageOptOut && (
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10"
            onClick={() => {
              setReleaseReason(t("optOutBanner.releaseReasonDefault"));
              setReleaseDialogOpen(true);
            }}
          >
            {t("optOutBanner.releaseButton")}
          </Button>
        )}
      </div>

      <Dialog open={releaseDialogOpen} onOpenChange={setReleaseDialogOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("optOutBanner.releaseDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("optOutBanner.releaseReasonLabel")}</Label>
            <Textarea
              value={releaseReason}
              onChange={(e) => setReleaseReason(e.target.value)}
              placeholder={t("optOutBanner.releaseReasonPlaceholder")}
              className="border-border bg-muted text-foreground"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReleaseDialogOpen(false)}
              disabled={releasing}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {t("optOutBanner.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleRelease}
              disabled={releasing || !releaseReason.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {releasing ? <Loader2 className="size-4 animate-spin" /> : t("optOutBanner.releaseButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
