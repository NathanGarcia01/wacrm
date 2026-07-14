"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage, Deal, Profile } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import {
  PipelineFilterBar,
  DEFAULT_PIPELINE_FILTERS,
  type PipelineFilters,
} from "@/components/pipelines/pipeline-filter-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { GatedButton } from "@/components/ui/gated-button";
import { LossesPanel } from "@/components/pipelines/losses-panel";
import { resolvePeriod } from "@/lib/reports/period";
import { exportDealsToCsv } from "@/lib/pipelines/export-csv";
import { Download, LayoutGrid, TrendingDown } from "lucide-react";

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Spec-defined seed — colors and position per the product spec; names
// are resolved from translations at use (see specDefaultStages below)
// since these get written verbatim into the DB on first pipeline creation.
const SPEC_DEFAULT_STAGE_META = [
  { labelKey: "defaultStageNewLead", color: "#3b82f6", position: 0 }, // blue
  { labelKey: "defaultStageQualified", color: "#eab308", position: 1 }, // yellow
  { labelKey: "defaultStageProposalSent", color: "#f97316", position: 2 }, // orange
  { labelKey: "defaultStageNegotiation", color: "#8b5cf6", position: 3 }, // purple
  { labelKey: "defaultStageWon", color: "#22c55e", position: 4 }, // green
] as const;

function specDefaultStages(t: ReturnType<typeof useTranslations>) {
  return SPEC_DEFAULT_STAGE_META.map((s) => ({
    name: t(s.labelKey),
    color: s.color,
    position: s.position,
  }));
}

export default function PipelinesPage() {
  const t = useTranslations("pipelines");
  const supabase = createClient();
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");
  const { accountId, defaultCurrency } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<PipelineFilters>(DEFAULT_PIPELINE_FILTERS);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      return data ?? [];
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("deals")
        .select(
          "*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*), products:deal_products(id, commission_value)",
        )
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });
      return (data ?? []) as Deal[];
    },
    [supabase],
  );

  // Account members for the "Responsável" filter — RLS scopes this to
  // the current account, same pattern as deal-form.tsx's assignee select.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("profiles").select("*").order("full_name");
      if (!cancelled) setProfiles((data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) return null;

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name: t("defaultPipelineName") })
      .select()
      .single();

    if (error || !pipeline) {
      console.error("Failed to seed pipeline:", error?.message);
      return null;
    }

    const stagesPayload = specDefaultStages(t).map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    return pipeline as Pipeline;
  }, [supabase, accountId, t]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    // A stage filter from a previously selected pipeline doesn't apply
    // here — stage ids are pipeline-specific.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters((f) => (f.stageId ? { ...f, stageId: "" } : f));

    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  // Keep the latest refreshDeals in a ref so the realtime subscription
  // below doesn't need it as a dependency — refreshDeals's identity
  // changes with `selectedPipelineId`, which would otherwise tear
  // down and resubscribe the channel on every pipeline switch.
  const refreshDealsRef = useRef(refreshDeals);
  useEffect(() => {
    refreshDealsRef.current = refreshDeals;
  }, [refreshDeals]);

  // Realtime: reflect deal changes made elsewhere (e.g. the inbox
  // contact sidebar's mini-sheet) without a manual reload. Scoped to
  // this account via `filter` so cross-tenant traffic never reaches
  // the client. One subscription per account, torn down on unmount /
  // account change — not re-created on every deals/stages refresh.
  useEffect(() => {
    if (!accountId) return;
    const channel = supabase
      .channel(`deals-changes-${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "deals",
          filter: `account_id=eq.${accountId}`,
        },
        () => refreshDealsRef.current(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, supabase]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      // Optimistic update — board already animated; just persist.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d)),
      );
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: newStageId })
        .eq("id", dealId);
      if (error) {
        toast.error(t("moveFailed"));
        refreshDeals();
      }
    },
    [supabase, refreshDeals],
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error(t("noAccountLinked"));
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error(t("createPipelineFailed"));
      setCreating(false);
      return;
    }

    const stagesPayload = specDefaultStages(t).map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    setNewPipelineName("");
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success(t("pipelineCreated"));
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  // "all" means no date restriction; otherwise resolve the same way
  // Reports/Dashboard do. Each deal is checked against its own
  // "effective date" (see filteredDeals below) rather than a single
  // column, since won_at/lost_at only exist once a deal has closed.
  const period = useMemo(
    () =>
      filters.periodKey === "all"
        ? null
        : resolvePeriod(filters.periodKey, filters.customFrom, filters.customTo),
    [filters.periodKey, filters.customFrom, filters.customTo],
  );

  const filteredDeals = useMemo(() => {
    return deals.filter((d) => {
      if (filters.status !== "all" && (d.status ?? "open") !== filters.status) return false;
      if (filters.assignedTo === "unassigned" && d.assigned_to) return false;
      if (
        filters.assignedTo !== "" &&
        filters.assignedTo !== "unassigned" &&
        d.assigned_to !== filters.assignedTo
      )
        return false;
      if (filters.stageId !== "" && d.stage_id !== filters.stageId) return false;
      if (period) {
        const effectiveDate = d.won_at ?? d.lost_at ?? d.created_at;
        if (effectiveDate < period.startISO || effectiveDate >= period.endISO) return false;
      }
      return true;
    });
  }, [deals, filters, period]);

  const [view, setView] = useState<"board" | "losses">("board");

  const handleExportCsv = useCallback(() => {
    exportDealsToCsv(filteredDeals, t);
  }, [filteredDeals, t]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? t("selectPipeline")}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-border bg-popover text-popover-foreground"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  {t("noPipelinesYet")}
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-popover-foreground"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-popover-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  {t("managePipelines")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          {pipelines.length > 0 && (
            <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
              <button
                type="button"
                onClick={() => setView("board")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  view === "board"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                {t("viewBoard")}
              </button>
              <button
                type="button"
                onClick={() => setView("losses")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  view === "losses"
                    ? "bg-destructive/15 text-destructive"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <TrendingDown className="h-3.5 w-3.5" />
                {t("viewLosses")}
              </button>
            </div>
          )}
          {pipelines.length > 0 && (
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={filteredDeals.length === 0}
              className="border-border bg-card text-foreground hover:bg-muted"
            >
              <Download className="mr-1 h-4 w-4" />
              {t("exportCsv")}
            </Button>
          )}
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addPipeline")}
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create deals"
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addDeal")}
          </GatedButton>
        </div>
      </div>

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            {t("noPipelinesYet")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("createPipelineHint")}
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("createPipeline")}
          </GatedButton>
        </div>
      ) : (
        <>
          <PipelineFilterBar
            filters={filters}
            onChange={setFilters}
            profiles={profiles}
            stages={stages}
          />
          {view === "board" ? (
            <>
              <PipelineAnalytics stages={stages} deals={filteredDeals} />
              <PipelineBoard
                stages={stages}
                deals={filteredDeals}
                onDealMoved={handleDealMoved}
                onAddDeal={handleAddDeal}
                onEditDeal={handleEditDeal}
              />
            </>
          ) : (
            <LossesPanel
              pipelineId={selectedPipelineId}
              stages={stages}
              assignedTo={filters.assignedTo}
              period={period}
              currency={defaultCurrency}
            />
          )}
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newPipeline")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">{t("pipelineNameLabel")}</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={t("pipelineNamePlaceholder")}
              className="mt-2 bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("defaultStagesHint")}
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? t("creating") : t("createPipeline")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}
