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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { X, Tag as TagIcon, ChevronDown } from "lucide-react";
import type { DealStatus, PipelineStage, Profile, Tag } from "@/types";
import type { PeriodKey } from "@/lib/reports/types";

export interface PipelineFilters {
  status: DealStatus | "all";
  assignedTo: string; // "" = all, "unassigned" = no assignee, else profile id
  stageId: string; // "" = all stages
  /** "all" = no date restriction. Filters each deal by its "effective
   *  date" — won_at / lost_at if closed, created_at if still open. */
  periodKey: PeriodKey | "all";
  customFrom?: string;
  customTo?: string;
  /** ANY-match: deal's contact must have at least one of these tags. */
  tagIds: string[];
}

export const DEFAULT_PIPELINE_FILTERS: PipelineFilters = {
  status: "open",
  assignedTo: "",
  stageId: "",
  periodKey: "all",
  tagIds: [],
};

export function countActivePipelineFilters(filters: PipelineFilters): number {
  let count = 0;
  if (filters.status !== DEFAULT_PIPELINE_FILTERS.status) count += 1;
  if (filters.assignedTo !== "") count += 1;
  if (filters.stageId !== "") count += 1;
  if (filters.periodKey !== "all") count += 1;
  if (filters.tagIds.length > 0) count += 1;
  return count;
}

interface PipelineFilterBarProps {
  filters: PipelineFilters;
  onChange: (filters: PipelineFilters) => void;
  profiles: Profile[];
  stages: PipelineStage[];
  tags: Tag[];
  /** Hides the Status control — the Perdas tab already forces
   *  status='lost' server-side, so showing it there let users toggle a
   *  filter that silently did nothing. */
  hideStatus?: boolean;
}

export function PipelineFilterBar({
  filters,
  onChange,
  profiles,
  stages,
  tags,
  hideStatus,
}: PipelineFilterBarProps) {
  const t = useTranslations("pipelines.filters");
  const activeCount = countActivePipelineFilters(filters);

  function toggleTag(tagId: string) {
    const next = filters.tagIds.includes(tagId)
      ? filters.tagIds.filter((id) => id !== tagId)
      : [...filters.tagIds, tagId];
    onChange({ ...filters, tagIds: next });
  }

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
  const periodItems = useMemo(
    () => ({
      all: t("periodAll"),
      today: t("periodToday"),
      week: t("periodWeek"),
      month: t("periodMonth"),
      custom: t("periodCustom"),
    }),
    [t],
  );

  return (
    <div
      data-tour="pipeline-filters"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/60 p-3"
    >
      {!hideStatus && (
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
      )}

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

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("tagsLabel")}</label>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className="h-9 w-48 justify-between border-border bg-muted font-normal text-foreground"
              />
            }
          >
            <span className="flex items-center gap-1.5 truncate">
              <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
              {filters.tagIds.length > 0
                ? t("tagsSelected", { count: filters.tagIds.length })
                : t("tagsAll")}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-sm font-medium text-popover-foreground">{t("tagsLabel")}</span>
              {filters.tagIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, tagIds: [] })}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {t("tagsClear")}
                </button>
              )}
            </div>
            {tags.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">{t("tagsNone")}</p>
            ) : (
              <div className="max-h-56 overflow-y-auto p-1">
                {tags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 cursor-pointer hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={filters.tagIds.includes(tag.id)}
                      onCheckedChange={() => toggleTag(tag.id)}
                      aria-label={tag.name}
                    />
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="text-sm text-popover-foreground truncate">{tag.name}</span>
                  </label>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground" title={t("periodHint")}>
          {t("periodLabel")}
        </label>
        <Select
          items={periodItems}
          value={filters.periodKey}
          onValueChange={(v) =>
            onChange({ ...filters, periodKey: (v || "all") as PipelineFilters["periodKey"] })
          }
        >
          <SelectTrigger className="w-40 bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("periodAll")}</SelectItem>
            <SelectItem value="today">{t("periodToday")}</SelectItem>
            <SelectItem value="week">{t("periodWeek")}</SelectItem>
            <SelectItem value="month">{t("periodMonth")}</SelectItem>
            <SelectItem value="custom">{t("periodCustom")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filters.periodKey === "custom" && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("periodFrom")}</label>
            <Input
              type="date"
              value={filters.customFrom ?? ""}
              max={filters.customTo}
              onChange={(e) => onChange({ ...filters, customFrom: e.target.value })}
              className="h-9 w-36 bg-muted"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("periodTo")}</label>
            <Input
              type="date"
              value={filters.customTo ?? ""}
              min={filters.customFrom}
              onChange={(e) => onChange({ ...filters, customTo: e.target.value })}
              className="h-9 w-36 bg-muted"
            />
          </div>
        </>
      )}

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
