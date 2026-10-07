"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Deal, DealEvent, PipelineStage } from "@/types";

/**
 * Fase 6, Etapa 1 — barra de etapas clicável do painel de detalhe.
 *
 * "Já percorridas" vem de deal_events (migration 101) quando existir
 * histórico pra este negócio: a união de every to_stage_id visto em
 * eventos 'created'/'stage_changed'. Sem histórico (negócio criado
 * antes da 101), cai na aproximação por position (<=  etapa atual) —
 * decisão explícita, documentada no diagnóstico: sem log de eventos
 * não dá pra saber se uma etapa intermediária foi mesmo visitada ou
 * só pulada.
 */
export function DealStageBar({
  deal,
  stages,
  events,
  onMoveStage,
  moving,
}: {
  deal: Deal;
  stages: PipelineStage[];
  events: DealEvent[];
  onMoveStage: (stageId: string) => void;
  /** Stage id currently being persisted — disables all pills so a
   *  double-click can't fire two moves in a row. */
  moving: string | null;
}) {
  const orderedStages = useMemo(() => [...stages].sort((a, b) => a.position - b.position), [stages]);

  const visitedStageIds = useMemo(() => {
    const stageEvents = events.filter((e) => e.event_type === "created" || e.event_type === "stage_changed");
    if (stageEvents.length === 0) return null;
    const set = new Set<string>();
    for (const e of stageEvents) {
      if (e.to_stage_id) set.add(e.to_stage_id);
    }
    set.add(deal.stage_id);
    return set;
  }, [events, deal.stage_id]);

  const currentStage = orderedStages.find((s) => s.id === deal.stage_id);

  function isCompleted(stage: PipelineStage): boolean {
    if (stage.id === deal.stage_id) return false;
    if (visitedStageIds) return visitedStageIds.has(stage.id);
    return currentStage ? stage.position < currentStage.position : false;
  }

  const closed = deal.status === "won" || deal.status === "lost";

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {orderedStages.map((stage, i) => {
        const isCurrent = stage.id === deal.stage_id;
        const completed = isCompleted(stage);
        return (
          <div key={stage.id} className="flex items-center gap-1">
            <button
              type="button"
              disabled={closed || moving !== null || isCurrent}
              onClick={() => onMoveStage(stage.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed",
                isCurrent
                  ? "border-transparent text-white"
                  : completed
                    ? "border-transparent bg-muted text-muted-foreground hover:bg-muted/70"
                    : "border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary",
              )}
              style={isCurrent ? { backgroundColor: stage.color } : undefined}
            >
              {completed && <Check className="h-3 w-3" />}
              {stage.name}
            </button>
            {i < orderedStages.length - 1 && (
              <div className={cn("h-px w-3 shrink-0", completed ? "bg-muted-foreground/40" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
