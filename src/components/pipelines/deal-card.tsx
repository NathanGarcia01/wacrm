"use client";

import { useTranslations } from "next-intl";
import type { Deal, DealIndicators, PipelineStage } from "@/types";
import { AlertTriangle, Calendar, Check, Clock, MessageCircle, ShieldOff, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  /** Fase 6 — indicadores em lote (get_pipeline_deal_indicators). */
  indicators?: DealIndicators;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, indicators, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations("pipelines.dealCard");
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;
  const commissionTotal = (deal.products ?? []).reduce(
    (sum, p) => sum + (p.commission_value ?? 0),
    0,
  );

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">
            <X className="h-3 w-3" />
            {t("lost")}
          </span>
        )}
      </div>

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-card-2 font-mono text-[10px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
      </div>

      {indicators &&
        (indicators.unreadCount > 0 ||
          indicators.ticketStatus ||
          indicators.outside24h ||
          indicators.optedOut ||
          indicators.overdueTasksCount > 0) && (
          <div className="mt-2 flex items-center gap-1.5">
            {indicators.unreadCount > 0 && (
              <span
                title={t("unreadTooltip", { count: indicators.unreadCount })}
                className="flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
              >
                <MessageCircle className="h-3 w-3" />
                {indicators.unreadCount}
              </span>
            )}
            {indicators.ticketStatus && (
              <span
                title={t(`ticketStatus.${indicators.ticketStatus}`)}
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  indicators.ticketStatus === "pending"
                    ? "bg-amber-500/15 text-amber-600"
                    : "bg-blue-500/15 text-blue-600"
                }`}
              >
                {t(`ticketStatus.${indicators.ticketStatus}`)}
              </span>
            )}
            {indicators.outside24h && (
              <span title={t("outside24hTooltip")}>
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            )}
            {indicators.optedOut && (
              <span title={t("optedOutTooltip")}>
                <ShieldOff className="h-3.5 w-3.5 text-destructive" />
              </span>
            )}
            {indicators.overdueTasksCount > 0 && (
              <span
                title={t("overdueTasksTooltip", { count: indicators.overdueTasksCount })}
                className="flex items-center gap-0.5 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive"
              >
                <AlertTriangle className="h-3 w-3" />
                {indicators.overdueTasksCount}
              </span>
            )}
          </div>
        )}

      <div className="mt-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-sm font-semibold text-primary">
            {formatCurrency(deal.value, deal.currency)}
          </span>
          {commissionTotal > 0 && (
            <span className="font-mono text-[11px] font-semibold text-gold" title={t("commissionTotal")}>
              +{formatCurrency(commissionTotal, deal.currency)}
            </span>
          )}
        </span>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-soft font-mono text-[10px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </button>
  );
}
