"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ClosingReason, Department, Profile } from "@/types";
import {
  runBulkAction,
  type BulkAction,
  type BulkActionSummary,
} from "@/lib/inbox/bulk-action-client";
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

type Step = "configure" | "confirm" | "running" | "summary";
type TransferTarget = "agent" | "department";

/**
 * Fase 1 (atendimento) — one dialog for every bulk action
 * (mark_read/mark_unread/assign/transfer/return_to_queue/close), used
 * by BOTH inboxes (old and new). `configure` is skipped for actions
 * that need no extra input; `close` only shows a reason picker when
 * `ticketsUiEnabled` — the old inbox has no such dialog today, so its
 * bulk close stays reasonless (server falls back to the system
 * 'no_reason_informed' placeholder, same as a single reasonless close
 * always has).
 *
 * `getTargetIds` is resolved only after the user confirms — for
 * "selecionar todos os N" this pages through the whole matching set
 * server-side (resolve-tab-conversation-ids.ts) before any action
 * runs, so a shrinking result set (closing a ticket removes it from
 * "Pendentes" mid-batch) can never cause rows to be skipped.
 */
export function BulkActionDialog({
  open,
  onOpenChange,
  action,
  ticketsUiEnabled,
  targetCount,
  profiles,
  currentUserId,
  presetPayload,
  getTargetIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: BulkAction;
  ticketsUiEnabled: boolean;
  targetCount: number;
  profiles: Profile[];
  currentUserId: string | undefined;
  /** Set when the target (agent to assign to, or "unassign") was
   *  already picked from a dropdown before this dialog opened — e.g.
   *  the bulk bar's existing "Atribuir" menu. Skips `configure`
   *  entirely and goes straight to `confirm` using this payload. */
  presetPayload?: Record<string, unknown>;
  getTargetIds: () => Promise<string[]>;
  onDone: (summary: BulkActionSummary) => void;
}) {
  const t = useTranslations("inbox.bulk");

  const needsConfigure = !presetPayload && (action === "transfer" || (action === "close" && ticketsUiEnabled));
  const [step, setStep] = useState<Step>(needsConfigure ? "configure" : "confirm");

  // transfer
  const [transferTarget, setTransferTarget] = useState<TransferTarget>("agent");
  const [transferAgentId, setTransferAgentId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  // close
  const [closingReasonId, setClosingReasonId] = useState("");
  const [note, setNote] = useState("");
  const [closingReasons, setClosingReasons] = useState<ClosingReason[]>([]);
  const [loadingPickerData, setLoadingPickerData] = useState(false);

  const [progress, setProgress] = useState({ processed: 0, total: targetCount });
  const [summary, setSummary] = useState<BulkActionSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(needsConfigure ? "configure" : "confirm");
    setTransferTarget("agent");
    setTransferAgentId("");
    setDepartmentId("");
    setClosingReasonId("");
    setNote("");
    setSummary(null);
    setProgress({ processed: 0, total: targetCount });

    if (action === "transfer") {
      setLoadingPickerData(true);
      const supabase = createClient();
      supabase
        .from("departments")
        .select("*")
        .eq("is_active", true)
        .order("name")
        .then(({ data }) => {
          setDepartments((data as Department[] | null) ?? []);
          setLoadingPickerData(false);
        });
    } else if (action === "close" && ticketsUiEnabled) {
      setLoadingPickerData(true);
      const supabase = createClient();
      supabase
        .from("closing_reasons")
        .select("*")
        .eq("is_system", false)
        .order("position")
        .then(({ data }) => {
          setClosingReasons((data as ClosingReason[] | null) ?? []);
          setLoadingPickerData(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action]);

  function buildPayload(): Record<string, unknown> | undefined {
    if (presetPayload) return presetPayload;
    switch (action) {
      case "transfer":
        return transferTarget === "agent"
          ? { agentId: transferAgentId }
          : { agentId: null, departmentId };
      case "close":
        return ticketsUiEnabled ? { closingReasonId, note: note.trim() || undefined } : undefined;
      default:
        return undefined;
    }
  }

  async function handleConfirm() {
    setStep("running");
    try {
      const ids = await getTargetIds();
      setProgress({ processed: 0, total: ids.length });
      const result = await runBulkAction(action, ids, buildPayload(), (processed, total) =>
        setProgress({ processed, total }),
      );
      setSummary(result);
      setStep("summary");
    } catch (err) {
      setSummary({
        total: targetCount,
        succeeded: [],
        skipped: [],
        failed: [{ conversationId: "*", status: "failed", reason: err instanceof Error ? err.message : t("unknownError") }],
      });
      setStep("summary");
    }
  }

  // "close" needs no gate here — picking a reason is optional (the
  // server falls back to the system placeholder when none is sent),
  // same relaxation as the single-ticket close dialog.
  const canConfirmConfigure =
    action === "transfer" ? (transferTarget === "agent" ? !!transferAgentId : !!departmentId) : true;

  return (
    <Dialog open={open} onOpenChange={(v) => step !== "running" && onOpenChange(v)}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
        {step === "configure" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t(`configureTitle.${action}`)}</DialogTitle>
            </DialogHeader>

            {action === "transfer" && (
              <>
                <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
                  {(["agent", "department"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setTransferTarget(opt)}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                        transferTarget === opt
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {opt === "agent" ? t("toAgent") : t("toDepartment")}
                    </button>
                  ))}
                </div>
                {transferTarget === "agent" ? (
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t("agentLabel")}</Label>
                    <Select value={transferAgentId} onValueChange={(v) => v && setTransferAgentId(v)}>
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
                      disabled={loadingPickerData}
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
                    <p className="text-xs text-muted-foreground">{t("departmentUnassignsHint")}</p>
                  </div>
                )}
              </>
            )}

            {action === "close" && ticketsUiEnabled && (
              <div className="space-y-3">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("reasonLabel")}</Label>
                  <Select
                    value={closingReasonId}
                    onValueChange={(v) => v && setClosingReasonId(v)}
                    disabled={loadingPickerData}
                  >
                    <SelectTrigger className="border-border bg-muted text-foreground">
                      <SelectValue placeholder={t("reasonPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {closingReasons.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("noteLabel")}</Label>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("notePlaceholder")}
                    className="min-h-[70px] border-border bg-muted text-foreground"
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => setStep("confirm")}
                disabled={!canConfirmConfigure}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("next")}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t("confirmTitle")}</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t("confirmDescription", { count: targetCount, action: t(`actionLabel.${action}`) })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("confirm")}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "running" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t("runningTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("runningProgress", { processed: progress.processed, total: progress.total })}
              </p>
            </div>
          </>
        )}

        {step === "summary" && summary && (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t("summaryTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <p className="text-foreground">
                {t("summarySucceeded", { count: summary.succeeded.length })}
              </p>
              {summary.skipped.length > 0 && (
                <p className="text-amber-500">
                  {t("summarySkipped", { count: summary.skipped.length })}
                </p>
              )}
              {summary.failed.length > 0 && (
                <p className="text-destructive">
                  {t("summaryFailed", { count: summary.failed.length })}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onDone(summary);
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("done")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
