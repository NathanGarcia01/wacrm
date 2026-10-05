"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Department, Profile, Ticket } from "@/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TransferTarget = "agent" | "department";

/**
 * Fase 1 (atendimento), Etapa 6 — transfer to a person OR to a
 * department with nobody assigned yet (two mutually-exclusive modes,
 * not "either or both" — picking a department here always clears
 * the current assignee, matching the approved semantics: a ticket
 * handed to a department's queue goes back to 'pending' until
 * someone on that team claims it).
 */
export function TransferTicketDialog({
  open,
  onOpenChange,
  ticket,
  profiles,
  currentUserId,
  onTransferred,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: Ticket;
  profiles: Profile[];
  currentUserId: string | undefined;
  onTransferred: (ticket: Ticket) => void;
}) {
  const t = useTranslations("inbox.tickets.transferDialog");
  const [target, setTarget] = useState<TransferTarget>("agent");
  const [agentId, setAgentId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget("agent");
    setAgentId("");
    setDepartmentId("");
    setLoadingDepartments(true);
    const supabase = createClient();
    supabase
      .from("departments")
      .select("*")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        setDepartments((data as Department[] | null) ?? []);
        setLoadingDepartments(false);
      });
  }, [open]);

  async function handleConfirm() {
    const body =
      target === "agent"
        ? { agentId }
        : { agentId: null, departmentId };
    setSaving(true);
    const res = await fetch(`/api/tickets/${ticket.id}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      toast.error(errBody?.error ?? t("failed"));
      return;
    }
    const { ticket: updated } = await res.json();
    onTransferred(updated);
    onOpenChange(false);
    toast.success(t("success"));
  }

  const canConfirm = target === "agent" ? !!agentId : !!departmentId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
          {(["agent", "department"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setTarget(opt)}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                target === opt
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt === "agent" ? t("toAgent") : t("toDepartment")}
            </button>
          ))}
        </div>

        {target === "agent" ? (
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("agentLabel")}</Label>
            <Select value={agentId} onValueChange={(v) => v && setAgentId(v)}>
              <SelectTrigger className="border-border bg-muted text-foreground">
                <SelectValue placeholder={t("agentPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>
                    {p.full_name}
                    {p.user_id === currentUserId ? ` (${t("me")})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("departmentLabel")}</Label>
            <Select
              value={departmentId}
              onValueChange={(v) => v && setDepartmentId(v)}
              disabled={loadingDepartments}
            >
              <SelectTrigger className="border-border bg-muted text-foreground">
                <SelectValue placeholder={t("departmentPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!loadingDepartments && departments.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("noDepartments")}</p>
            )}
            <p className="text-xs text-muted-foreground">{t("departmentUnassignsHint")}</p>
          </div>
        )}

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
            disabled={saving || !canConfirm}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
