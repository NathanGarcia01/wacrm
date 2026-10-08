"use client";

import { useTranslations } from "next-intl";
import type { DealEvent, PipelineStage, Profile } from "@/types";
import { formatCurrency } from "@/lib/currency";
import {
  ArrowRightLeft,
  Check,
  CircleDot,
  DollarSign,
  Sparkles,
  User,
  X,
} from "lucide-react";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const EVENT_ICON: Record<DealEvent["event_type"], typeof CircleDot> = {
  created: Sparkles,
  stage_changed: ArrowRightLeft,
  won: Check,
  lost: X,
  assignee_changed: User,
  value_changed: DollarSign,
};

/**
 * Fase 6 — última etapa da aba Registros: renderização legível de
 * deal_events (migration 101), que até aqui só mostrava "data —
 * event_type" cru. actor_id é auth.uid() (bate com profiles.user_id),
 * já from/to_assigned_to são deals.assigned_to (bate com profiles.id)
 * — são colunas diferentes, resolvidas contra o mesmo array de
 * profiles de formas diferentes (ver log_deal_event(), migration 101).
 * actor_id null = automação/fluxo/cron (service role não tem
 * auth.uid()), nunca um humano.
 */
export function DealEventsTab({
  events,
  stages,
  profiles,
  currency,
}: {
  events: DealEvent[];
  stages: PipelineStage[];
  profiles: Profile[];
  currency: string;
}) {
  const t = useTranslations("pipelines.dealDetail");

  function actorLabel(actorId: string | null): string {
    if (!actorId) return t("eventActorSystem");
    const p = profiles.find((prof) => prof.user_id === actorId);
    return p?.full_name || p?.email || t("eventActorUnknown");
  }

  function assigneeLabel(profileId: string | null): string {
    if (!profileId) return t("eventAssigneeNone");
    const p = profiles.find((prof) => prof.id === profileId);
    return p?.full_name || p?.email || t("eventActorUnknown");
  }

  function stageLabel(stageId: string | null): string {
    if (!stageId) return t("eventAssigneeNone");
    return stages.find((s) => s.id === stageId)?.name ?? t("eventActorUnknown");
  }

  function describe(event: DealEvent): string {
    switch (event.event_type) {
      case "created":
        return t("eventCreated");
      case "stage_changed":
        return t("eventStageChanged", {
          from: stageLabel(event.from_stage_id),
          to: stageLabel(event.to_stage_id),
        });
      case "won":
        return t("eventWon");
      case "lost":
        return event.lost_reason
          ? t("eventLostWithReason", { reason: event.lost_reason })
          : t("eventLost");
      case "assignee_changed":
        return t("eventAssigneeChanged", {
          from: assigneeLabel(event.from_assigned_to),
          to: assigneeLabel(event.to_assigned_to),
        });
      case "value_changed":
        return t("eventValueChanged", {
          from: formatCurrency(event.from_value ?? 0, currency),
          to: formatCurrency(event.to_value ?? 0, currency),
        });
      default:
        return event.event_type;
    }
  }

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("eventsEmpty")}</p>;
  }

  return (
    <ul className="space-y-3">
      {[...events].reverse().map((event) => {
        const Icon = EVENT_ICON[event.event_type] ?? CircleDot;
        return (
          <li key={event.id} className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card-2">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 border-b border-border/50 pb-3">
              <p className="text-xs text-foreground">{describe(event)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatDateTime(event.created_at)} · {actorLabel(event.actor_id)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
