"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { ClosingReason, Ticket } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Fase 1 (atendimento), Etapa 6 — the close dialog. Picking a reason
 * is OPTIONAL: Confirm works either way — with a reason picked, same
 * as before; with none, the server falls back to the seeded
 * 'no_reason_informed' placeholder (closeTicketWithoutReason), still
 * attributed to this agent (closed_by='agent') and still firing NPS.
 *
 * Only ever lists `is_system = false` closing reasons: the two system
 * placeholders ("Encerrado por inatividade", "Encerrado (sem motivo
 * informado)") exist for the automated/no-reason close paths, never
 * for an agent to hand-pick here — POST /api/tickets/[id]/close
 * rejects them server-side too if somehow sent, this is UX, not the
 * real guard.
 */
export function CloseTicketDialog({
  open,
  onOpenChange,
  ticket,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: Ticket;
  onClosed: (ticket: Ticket) => void;
}) {
  const t = useTranslations("inbox.tickets.closeDialog");
  const [reasons, setReasons] = useState<ClosingReason[]>([]);
  const [loadingReasons, setLoadingReasons] = useState(false);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReasonId("");
    setNote("");
    setLoadingReasons(true);
    const supabase = createClient();
    supabase
      .from("closing_reasons")
      .select("*")
      .eq("is_system", false)
      .order("position")
      .then(({ data }) => {
        setReasons((data as ClosingReason[] | null) ?? []);
        setLoadingReasons(false);
      });
  }, [open]);

  async function handleConfirm() {
    setSaving(true);
    const res = await fetch(`/api/tickets/${ticket.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closingReasonId: reasonId || undefined, note: note.trim() || undefined }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error ?? t("failed"));
      return;
    }
    const { ticket: updated } = await res.json();
    onClosed(updated);
    onOpenChange(false);
    toast.success(t("success"));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("reasonLabel")}</Label>
            <Select value={reasonId} onValueChange={(v) => v && setReasonId(v)} disabled={loadingReasons}>
              <SelectTrigger className="border-border bg-muted text-foreground">
                <SelectValue placeholder={t("reasonPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {reasons.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!loadingReasons && reasons.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("noReasons")}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("noteLabel")}</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              className="min-h-[80px] border-border bg-muted text-foreground"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-border bg-transparent text-muted-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
