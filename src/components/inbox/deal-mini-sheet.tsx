"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { DollarSign, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Deal, PipelineStage, Profile } from "@/types";
import { fireAutomationTrigger } from "@/lib/automations/client-dispatch";

interface DealMiniSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null → create a new deal for this contact. */
  deal: Deal | null;
  contactId: string;
  onSaved: () => void;
}

/**
 * Lightweight deal editor for the inbox contact sidebar — title,
 * stage, value, assignee only. The full editor (contact, currency,
 * notes, close date, won/lost actions) lives in
 * src/components/pipelines/deal-form.tsx; this one intentionally
 * stays narrow since it's opened mid-conversation.
 */
export function DealMiniSheet({
  open,
  onOpenChange,
  deal,
  contactId,
  onSaved,
}: DealMiniSheetProps) {
  const t = useTranslations("inbox.dealSheet");
  const tc = useTranslations("common");
  const { user, accountId, defaultCurrency } = useAuth();

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [stageId, setStageId] = useState("");
  const [pipelineId, setPipelineId] = useState("");

  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loadingStages, setLoadingStages] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset fields whenever the sheet opens for a (possibly different)
  // deal — a legitimate prop-driven sync, not a fetch side effect.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(deal?.title ?? "");
    setValue(deal ? String(deal.value ?? "") : "");
    setAssignedTo(deal?.assigned_to ?? "");
  }, [open, deal]);

  // Resolve which pipeline's stages to show: the deal's own pipeline
  // when editing, or the account's default pipeline (oldest by
  // created_at — pipelines have no explicit ordering column) when
  // creating. Then load its stages, ordered by position, and default
  // to the deal's current stage (edit) or the first stage (create).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingStages(true);
    const supabase = createClient();

    (async () => {
      let targetPipelineId = deal?.pipeline_id ?? "";
      if (!targetPipelineId) {
        const { data: defaultPipeline } = await supabase
          .from("pipelines")
          .select("id")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        targetPipelineId = defaultPipeline?.id ?? "";
      }
      if (cancelled) return;
      if (!targetPipelineId) {
        setPipelineId("");
        setStages([]);
        setStageId("");
        setLoadingStages(false);
        return;
      }

      const { data: stageRows } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", targetPipelineId)
        .order("position", { ascending: true });
      if (cancelled) return;

      const loaded = (stageRows ?? []) as PipelineStage[];
      setPipelineId(targetPipelineId);
      setStages(loaded);
      setStageId(deal?.stage_id || loaded[0]?.id || "");
      setLoadingStages(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, deal]);

  // Account members for the "Responsável" picker.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data }) => {
        if (!cancelled) setProfiles((data ?? []) as Profile[]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleSave() {
    if (!title.trim() || !stageId) {
      toast.error(t("titleAndStageRequired"));
      return;
    }
    setSaving(true);
    const supabase = createClient();

    if (deal) {
      const previousStageId = deal.stage_id;
      const { error } = await supabase
        .from("deals")
        .update({
          title: title.trim(),
          stage_id: stageId,
          value: parseFloat(value) || 0,
          assigned_to: assignedTo || null,
        })
        .eq("id", deal.id);
      setSaving(false);
      if (error) {
        toast.error(t("saveFailed"));
        return;
      }
      if (previousStageId !== stageId) {
        fireAutomationTrigger("deal_stage_changed", contactId, {
          vars: { from_stage_id: previousStageId, to_stage_id: stageId },
        });
      }
      toast.success(t("dealUpdated"));
    } else {
      if (!user || !accountId) {
        toast.error(t("notAuthenticated"));
        setSaving(false);
        return;
      }
      if (!pipelineId) {
        toast.error(t("noPipelineAvailable"));
        setSaving(false);
        return;
      }
      const { error } = await supabase.from("deals").insert({
        user_id: user.id,
        account_id: accountId,
        contact_id: contactId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: title.trim(),
        value: parseFloat(value) || 0,
        currency: defaultCurrency || "BRL",
        assigned_to: assignedTo || null,
        status: "open",
      });
      setSaving(false);
      if (error) {
        toast.error(t("createFailed"));
        return;
      }
      toast.success(t("dealCreated"));
    }

    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full border-border bg-popover p-0 text-popover-foreground sm:max-w-sm"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? t("editDeal") : t("newDeal")}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("titleLabel")}</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("stageLabel")}</Label>
              <Select
                value={stageId}
                onValueChange={(v) => setStageId(v ?? "")}
                disabled={loadingStages}
              >
                <SelectTrigger className="w-full bg-muted">
                  <SelectValue placeholder={t("stagePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">
                {t("valueLabel", { currency: defaultCurrency || "BRL" })}
              </Label>
              <div className="relative">
                <DollarSign className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="number"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="0"
                  className="border-border bg-muted pl-7 text-foreground"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("assignedToLabel")}</Label>
              <Select
                value={assignedTo || "__unassigned__"}
                onValueChange={(v) => setAssignedTo(!v || v === "__unassigned__" ? "" : v)}
              >
                <SelectTrigger className="w-full bg-muted">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__">{t("unassigned")}</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name || p.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {tc("cancel")}
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving || !title.trim() || !stageId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : deal ? (
                  t("saveChanges")
                ) : (
                  t("newDeal")
                )}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
