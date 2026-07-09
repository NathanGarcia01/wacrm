"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import type { DealStatus, PipelineStage, Profile } from "@/types";

export interface PipelineFilters {
  status: DealStatus | "all";
  assignedTo: string; // "" = all, "unassigned" = no assignee, else profile id
  stageId: string; // "" = all stages
}

export const DEFAULT_PIPELINE_FILTERS: PipelineFilters = {
  status: "open",
  assignedTo: "",
  stageId: "",
};

export function countActivePipelineFilters(filters: PipelineFilters): number {
  let count = 0;
  if (filters.status !== DEFAULT_PIPELINE_FILTERS.status) count += 1;
  if (filters.assignedTo !== "") count += 1;
  if (filters.stageId !== "") count += 1;
  return count;
}

interface PipelineFilterBarProps {
  filters: PipelineFilters;
  onChange: (filters: PipelineFilters) => void;
  profiles: Profile[];
  stages: PipelineStage[];
}

export function PipelineFilterBar({
  filters,
  onChange,
  profiles,
  stages,
}: PipelineFilterBarProps) {
  const t = useTranslations("pipelines.filters");
  const activeCount = countActivePipelineFilters(filters);

  // Base UI's <Select> only resolves the trigger's displayed label from
  // its `items` map (or from the popup's <SelectItem> children once the
  // popup has actually been opened) — without `items`, the trigger shows
  // the raw value ("open", "__all__") until the user opens it once.
  // Passing `items` up front keeps the closed trigger's label correct.
  const statusItems = useMemo(
    () => ({
      all: t("statusAll"),
      open: t("statusOpen"),
      won: t("statusWon"),
      lost: t("statusLost"),
    }),
    [t],
  );
  const responsibleItems = useMemo(() => {
    const items: Record<string, string> = {
      __all__: t("responsibleAll"),
      unassigned: t("responsibleUnassigned"),
    };
    for (const p of profiles) items[p.id] = p.full_name || p.email;
    return items;
  }, [t, profiles]);
  const stageItems = useMemo(() => {
    const items: Record<string, string> = { __all__: t("stageAll") };
    for (const s of stages) items[s.id] = s.name;
    return items;
  }, [t, stages]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/60 p-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("statusLabel")}
        </label>
        <Select
          items={statusItems}
          value={filters.status}
          onValueChange={(v) =>
            onChange({ ...filters, status: v as DealStatus | "all" })
          }
        >
          <SelectTrigger className="w-40 bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("statusAll")}</SelectItem>
            <SelectItem value="open">{t("statusOpen")}</SelectItem>
            <SelectItem value="won">{t("statusWon")}</SelectItem>
            <SelectItem value="lost">{t("statusLost")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("responsibleLabel")}
        </label>
        <Select
          items={responsibleItems}
          value={filters.assignedTo === "" ? "__all__" : filters.assignedTo}
          onValueChange={(v) =>
            onChange({ ...filters, assignedTo: !v || v === "__all__" ? "" : v })
          }
        >
          <SelectTrigger className="w-48 bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("responsibleAll")}</SelectItem>
            <SelectItem value="unassigned">{t("responsibleUnassigned")}</SelectItem>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.full_name || p.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("stageLabel")}
        </label>
        <Select
          items={stageItems}
          value={filters.stageId === "" ? "__all__" : filters.stageId}
          onValueChange={(v) =>
            onChange({ ...filters, stageId: !v || v === "__all__" ? "" : v })
          }
        >
          <SelectTrigger className="w-48 bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("stageAll")}</SelectItem>
            {stages.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activeCount > 0 && (
        <div className="ml-auto flex items-center gap-2 self-end">
          <Badge variant="secondary">{t("activeFilters", { count: activeCount })}</Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(DEFAULT_PIPELINE_FILTERS)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="mr-1 h-3.5 w-3.5" />
            {t("clearFilters")}
          </Button>
        </div>
      )}
    </div>
  );
}
