"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Target = "automation" | "flow";

interface DraftStep {
  step_type: string;
  step_config: Record<string, unknown>;
  branches?: { yes?: DraftStep[]; no?: DraftStep[] };
}

interface AutomationDraft {
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  steps: DraftStep[];
}

interface FlowDraftNode {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

interface FlowDraft {
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowDraftNode[];
}

// Mirrors STEP_META in automation-builder.tsx so labels match the real
// builder exactly — kept as a small local copy rather than importing an
// unexported constant from that file.
const STEP_LABEL_KEYS: Record<string, string> = {
  send_message: "stepSendMessage",
  send_template: "stepSendTemplate",
  add_tag: "stepAddTag",
  remove_tag: "stepRemoveTag",
  assign_conversation: "stepAssignConversation",
  update_contact_field: "stepUpdateContactField",
  create_deal: "stepCreateDeal",
  wait: "stepWait",
  condition: "stepCondition",
  send_webhook: "stepSendWebhook",
  close_conversation: "stepCloseConversation",
};

const EXAMPLE_KEYS = [
  "exampleWelcome",
  "exampleFollowUp",
  "exampleQualify",
  "exampleNps",
] as const;

interface AiGenerateModalProps {
  target: Target;
  /** Called after the draft is persisted. `editManually` tells the
   *  caller whether to route into the full builder or just refresh the
   *  list in place. */
  onSaved: (id: string, editManually: boolean) => void;
}

export function AiGenerateModal({ target, onSaved }: AiGenerateModalProps) {
  const t = useTranslations("aiGenerate");
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [automationDraft, setAutomationDraft] = useState<AutomationDraft | null>(null);
  const [flowDraft, setFlowDraft] = useState<FlowDraft | null>(null);

  const draft = target === "automation" ? automationDraft : flowDraft;

  function reset() {
    setDescription("");
    setAutomationDraft(null);
    setFlowDraft(null);
  }

  async function handleGenerate() {
    if (!description.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch(
        target === "automation" ? "/api/ai/generate-automation" : "/api/ai/generate-flow",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: description.trim() }),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t("generateFailed"));
        return;
      }
      if (target === "automation") setAutomationDraft(payload.draft as AutomationDraft);
      else setFlowDraft(payload.draft as FlowDraft);
    } catch {
      toast.error(t("generateFailed"));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave(editManually: boolean) {
    setSaving(true);
    try {
      if (target === "automation" && automationDraft) {
        const res = await fetch("/api/automations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: automationDraft.name,
            description: automationDraft.description,
            trigger_type: automationDraft.trigger_type,
            trigger_config: automationDraft.trigger_config,
            is_active: false,
            steps: automationDraft.steps,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload?.error ?? t("saveFailed"));
          return;
        }
        toast.success(t("automationSaved"));
        setOpen(false);
        reset();
        onSaved(payload.automation.id, editManually);
      } else if (target === "flow" && flowDraft) {
        const res = await fetch("/api/flows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: flowDraft.name,
            description: flowDraft.description,
            trigger_type: flowDraft.trigger_type,
            trigger_config: flowDraft.trigger_config,
            entry_node_id: flowDraft.entry_node_id,
            nodes: flowDraft.nodes,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload?.error ?? t("saveFailed"));
          return;
        }
        toast.success(t("flowSaved"));
        setOpen(false);
        reset();
        onSaved(payload.flow.id, editManually);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
      >
        <Sparkles className="h-4 w-4" />
        {t("buttonLabel")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="sm:max-w-2xl bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {t("modalTitle")}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("modalDescription")}
            </DialogDescription>
          </DialogHeader>

          {!draft ? (
            <div className="space-y-3">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  target === "automation"
                    ? t("promptPlaceholderAutomation")
                    : t("promptPlaceholderFlow")
                }
                rows={4}
                className="w-full resize-none rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
              />
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">{t("examplesLabel")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {EXAMPLE_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDescription(t(key))}
                      className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-sm font-semibold text-foreground">{draft.name}</p>
              {draft.description && (
                <p className="text-xs text-muted-foreground">{draft.description}</p>
              )}
              {target === "automation" ? (
                <AutomationStepsPreview steps={automationDraft?.steps ?? []} />
              ) : (
                <FlowNodesPreview
                  nodes={flowDraft?.nodes ?? []}
                  entryNodeId={flowDraft?.entry_node_id ?? ""}
                />
              )}
            </div>
          )}

          <DialogFooter>
            {!draft ? (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={generating}>
                  {t("close")}
                </Button>
                <Button onClick={handleGenerate} disabled={!description.trim() || generating}>
                  {generating && <Loader2 className="h-4 w-4 animate-spin" />}
                  {target === "automation" ? t("generateButtonAutomation") : t("generateButtonFlow")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAutomationDraft(null);
                    setFlowDraft(null);
                  }}
                  disabled={saving}
                >
                  {t("startOver")}
                </Button>
                <Button variant="outline" onClick={() => handleSave(true)} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("editManually")}
                </Button>
                <Button onClick={() => handleSave(false)} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("saveAnyway")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AutomationStepsPreview({ steps, depth = 0 }: { steps: DraftStep[]; depth?: number }) {
  const t = useTranslations("automations.builder");
  const tAi = useTranslations("aiGenerate");
  if (steps.length === 0) {
    return depth === 0 ? <p className="text-xs text-muted-foreground">{tAi("noSteps")}</p> : null;
  }
  return (
    <ol className={cn("space-y-1.5", depth > 0 && "ml-4 border-l border-border pl-3")}>
      {steps.map((step, i) => (
        <li key={i} className="rounded-md bg-card px-2.5 py-1.5 text-xs">
          <span className="font-medium text-foreground">
            {i + 1}.{" "}
            {STEP_LABEL_KEYS[step.step_type] ? t(STEP_LABEL_KEYS[step.step_type]) : step.step_type}
          </span>
          {step.step_type === "condition" && step.branches && (
            <div className="mt-1.5 space-y-1.5">
              <div>
                <span className="text-[11px] font-medium text-primary">{tAi("branchYes")}</span>
                <AutomationStepsPreview steps={step.branches.yes ?? []} depth={depth + 1} />
              </div>
              <div>
                <span className="text-[11px] font-medium text-destructive">{tAi("branchNo")}</span>
                <AutomationStepsPreview steps={step.branches.no ?? []} depth={depth + 1} />
              </div>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function FlowNodesPreview({
  nodes,
  entryNodeId,
}: {
  nodes: FlowDraftNode[];
  entryNodeId: string;
}) {
  const t = useTranslations("flows.nodeTypes");
  const tAi = useTranslations("aiGenerate");
  if (nodes.length === 0) {
    return <p className="text-xs text-muted-foreground">{tAi("noSteps")}</p>;
  }
  return (
    <ol className="space-y-1.5">
      {nodes.map((node) => {
        const summary = summarizeNodeConfig(node);
        return (
          <li key={node.node_key} className="rounded-md bg-card px-2.5 py-1.5 text-xs">
            <div className="flex items-center gap-1.5">
              {node.node_key === entryNodeId && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {tAi("entryBadge")}
                </span>
              )}
              <span className="font-medium text-foreground">{t(node.node_type)}</span>
              <span className="text-muted-foreground">({node.node_key})</span>
            </div>
            {summary && <p className="mt-0.5 truncate text-muted-foreground">{summary}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function summarizeNodeConfig(node: FlowDraftNode): string | null {
  const cfg = node.config;
  if (typeof cfg.text === "string") return cfg.text;
  if (typeof cfg.prompt_text === "string") return cfg.prompt_text;
  if (node.node_type === "condition") {
    return [cfg.subject, cfg.operator, cfg.value].filter(Boolean).join(" ");
  }
  return null;
}
