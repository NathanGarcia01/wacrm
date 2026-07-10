"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Deal, PipelineStage } from "@/types";
import { DealCard } from "./deal-card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus, Filter } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

// Best-effort, name-based heuristic — deal.status='lost' doesn't imply
// anything about which stage the deal sits in (marking a deal Lost only
// touches status/lost_reason, never stage_id — see deal-form.tsx), and
// stages carry no "this is the loss bucket" flag in the schema. So there
// is no fully reliable, generic way to identify "the Lost stage" from
// data alone. This catches the common convention (a stage literally
// named "Perdido"/"Lost"/"Perdida"); an account that calls its loss
// stage something else (e.g. "Sem margem") won't be caught — known
// limitation, flagged rather than guessed around with fragile matching.
const LOST_STAGE_KEYWORDS = ["perdido", "perdida", "lost"];
function isLostLikeStage(stageName: string): boolean {
  const normalized = stageName.trim().toLowerCase();
  return LOST_STAGE_KEYWORDS.some((k) => normalized === k);
}

const FUNNEL_EFFECT_STORAGE_KEY = "wacrm.pipelineFunnelEffect";
const FUNNEL_WIDTH_MAX = 260;
const FUNNEL_WIDTH_STEP = 30;
const FUNNEL_WIDTH_MIN = 150;

interface PipelineBoardProps {
  stages: PipelineStage[];
  deals: Deal[];
  onDealMoved: (dealId: string, newStageId: string) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
}

export function PipelineBoard({
  stages,
  deals,
  onDealMoved,
  onAddDeal,
  onEditDeal,
}: PipelineBoardProps) {
  const t = useTranslations("pipelines");
  const { defaultCurrency } = useAuth();
  const [activeDealId, setActiveDealId] = useState<string | null>(null);

  // Defaults on (the redesign's signature look); remembered per browser
  // like the theme/mode pickers, for accounts with many deals per stage
  // that prefer a plain kanban.
  const [funnelEffect, setFunnelEffect] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem(FUNNEL_EFFECT_STORAGE_KEY);
    if (saved !== null) setFunnelEffect(saved === "true");
  }, []);
  const toggleFunnelEffect = (checked: boolean) => {
    setFunnelEffect(checked);
    localStorage.setItem(FUNNEL_EFFECT_STORAGE_KEY, String(checked));
  };

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  // Lost-like stages are excluded from the narrowing sequence (and its
  // width index) — they render after it, at a fixed width, visually
  // split off so they never look like "the next funnel step".
  const funnelStages = useMemo(
    () => sortedStages.filter((s) => !isLostLikeStage(s.name)),
    [sortedStages],
  );
  const lostStages = useMemo(
    () => sortedStages.filter((s) => isLostLikeStage(s.name)),
    [sortedStages],
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    return map;
  }, [sortedStages, deals]);

  const sensors = useSensors(
    // 5px activation distance avoids clicks being interpreted as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag support: focus a card, Space to pick up, arrows to move,
    // Space to drop, Escape to cancel.
    useSensor(KeyboardSensor),
  );

  const activeDeal = activeDealId
    ? deals.find((d) => d.id === activeDealId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const targetStageId = String(over.id);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    onDealMoved(dealId, targetStageId);
  }

  function handleDragCancel() {
    setActiveDealId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="mb-3 flex items-center justify-end gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground">{t("funnelEffectLabel")}</span>
        <Switch checked={funnelEffect} onCheckedChange={toggleFunnelEffect} />
      </div>

      {/* snap-x + snap-mandatory on mobile so swipes land the next
          stage cleanly at the viewport edge instead of mid-column.
          Disabled on lg+ where snapping would interfere with the
          natural layout. The board can still overflow horizontally on
          lg+ once a pipeline has many stages (columns keep a 260px
          min-width), so a thin scrollbar stays visible on desktop. */}
      <div className="pipeline-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none">
        {funnelStages.map((stage, i) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];
          const totalValue = stageDeals.reduce(
            (s, d) => s + Number(d.value || 0),
            0,
          );
          const width = funnelEffect
            ? Math.max(FUNNEL_WIDTH_MIN, FUNNEL_WIDTH_MAX - i * FUNNEL_WIDTH_STEP)
            : null;
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={stageDeals}
              totalValue={totalValue}
              currency={defaultCurrency}
              onAddDeal={onAddDeal}
              onEditDeal={onEditDeal}
              widthPx={width}
            />
          );
        })}
        {lostStages.map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];
          const totalValue = stageDeals.reduce(
            (s, d) => s + Number(d.value || 0),
            0,
          );
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={stageDeals}
              totalValue={totalValue}
              currency={defaultCurrency}
              onAddDeal={onAddDeal}
              onEditDeal={onEditDeal}
              widthPx={funnelEffect ? FUNNEL_WIDTH_MAX : null}
              isLostLike={funnelEffect}
            />
          );
        })}
      </div>

      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        {activeDeal ? (
          <div className="opacity-90">
            <DealCard
              deal={activeDeal}
              stage={
                sortedStages.find((s) => s.id === activeDeal.stage_id) ?? null
              }
              onEdit={() => {}}
              isOverlay
            />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .pipeline-scroll {
          scroll-behavior: smooth;
        }
        /* On touch devices the peek/snap layout already signals there's
           more to swipe, so the scrollbar is hidden for a clean look.
           On desktop (mouse) the board can overflow with many stages
           and there is no peek hint, so keep a thin, themed scrollbar
           visible to make the overflow discoverable and usable. */
        @media (hover: none), (pointer: coarse) {
          .pipeline-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .pipeline-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .pipeline-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .pipeline-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .pipeline-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
      `}</style>
    </DndContext>
  );
}

function StageColumn({
  stage,
  deals,
  totalValue,
  currency,
  onAddDeal,
  onEditDeal,
  widthPx,
  isLostLike,
}: {
  stage: PipelineStage;
  deals: Deal[];
  totalValue: number;
  currency: string;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  /** Explicit desktop width in px when the funnel effect is on; null
   *  restores the equal-share flex-1 kanban layout. Mobile ignores
   *  this entirely — it always uses its own peek-preview sizing. */
  widthPx?: number | null;
  /** Visually splits this column off from the narrowing sequence — see
   *  isLostLikeStage's caveats in the parent for how this is detected. */
  isLostLike?: boolean;
}) {
  const t = useTranslations("pipelines");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const style = widthPx
    ? ({ "--stage-width": `${widthPx}px` } as React.CSSProperties)
    : undefined;

  return (
    // On mobile each column is `w-[85vw]` (with a reasonable min/max)
    // so the next column's edge peeks in — a "there's more here" hint.
    // snap-start lands each column cleanly when swiping. On lg+, either
    // an explicit --stage-width (funnel effect) or the equal-share
    // flex-1 kanban layout, set by the caller. The droppable ref is
    // on the inner messages region below — intentionally NOT here, so
    // a drag over the column header doesn't highlight the whole column.
    <div
      style={style}
      className={cn(
        "flex w-[85vw] min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:max-w-none lg:shrink lg:snap-none",
        widthPx
          ? "lg:w-[var(--stage-width)] lg:flex-none lg:basis-[var(--stage-width)]"
          : "lg:w-auto lg:flex-1 lg:basis-[260px]",
        // The left border + gap read as "this column split off from the
        // sequence" — border-only (no stage.color accent) is a deliberate
        // second signal alongside the destructive top border below.
        isLostLike && "lg:ml-3 lg:border-l-2 lg:border-l-destructive/40 lg:pl-[calc(1rem-2px)]",
      )}
    >
      {/* 3px colored top border — destructive for the lost-like column
          (see isLostLikeStage) instead of the stage's own color, so it
          never reads as just another funnel step. */}
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: isLostLike ? "var(--destructive)" : stage.color }}
      />
      <div className="flex items-center justify-between pt-3">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {stage.name}
        </h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {deals.length}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatCurrency(totalValue, currency)}
      </p>

      <div
        ref={setNodeRef}
        className={`mt-3 flex flex-1 flex-col gap-2 rounded-lg transition-all ${
          isOver
            ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
            : ""
        }`}
      >
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {t("dropDealHere")}
          </div>
        ) : (
          deals.map((deal) => (
            <DraggableDealCard
              key={deal.id}
              deal={deal}
              stage={stage}
              onEdit={onEditDeal}
            />
          ))
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAddDeal(stage.id)}
        className="mt-3 w-full justify-start border border-dashed border-border bg-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
      >
        <Plus className="mr-1 h-3 w-3" />
        {t("addDeal")}
      </Button>
    </div>
  );
}

function DraggableDealCard({
  deal,
  stage,
  onEdit,
}: {
  deal: Deal;
  stage: PipelineStage;
  onEdit: (deal: Deal) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
    >
      <DealCard deal={deal} stage={stage} onEdit={onEdit} />
    </div>
  );
}
