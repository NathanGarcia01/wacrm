"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Filter, Loader2 } from "lucide-react";
import type { PipelineStage, Profile, Tag } from "@/types";

export type DealStatusFilter = "open" | "won" | "lost" | "none";
export type DateRangeFilter = "today" | "week" | "month";

export interface ConversationFiltersState {
  /** profile.user_id, or the literal "unassigned". */
  assignedTo: string | null;
  stageId: string | null;
  dealStatus: DealStatusFilter | null;
  tagIds: string[];
  dateRange: DateRangeFilter | null;
}

export const EMPTY_CONVERSATION_FILTERS: ConversationFiltersState = {
  assignedTo: null,
  stageId: null,
  dealStatus: null,
  tagIds: [],
  dateRange: null,
};

export function countActiveConversationFilters(f: ConversationFiltersState): number {
  let n = 0;
  if (f.assignedTo) n++;
  if (f.stageId) n++;
  if (f.dealStatus) n++;
  if (f.tagIds.length > 0) n++;
  if (f.dateRange) n++;
  return n;
}

interface ConversationFiltersPopoverProps {
  filters: ConversationFiltersState;
  onChange: (filters: ConversationFiltersState) => void;
}

export function ConversationFiltersPopover({
  filters,
  onChange,
}: ConversationFiltersPopoverProps) {
  const t = useTranslations("inbox.filters");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  // Load the picker options each time the popover opens — cheap queries,
  // and guarantees a teammate/stage/tag created elsewhere shows up.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const supabase = createClient();
    (async () => {
      const [profilesRes, stagesRes, tagsRes] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("pipeline_stages").select("*").order("position"),
        supabase.from("tags").select("*").order("name"),
      ]);
      if (cancelled) return;
      setProfiles((profilesRes.data ?? []) as Profile[]);
      setStages((stagesRes.data ?? []) as PipelineStage[]);
      setTags((tagsRes.data ?? []) as Tag[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const activeCount = countActiveConversationFilters(filters);

  function update(patch: Partial<ConversationFiltersState>) {
    onChange({ ...filters, ...patch });
  }

  function toggleTag(tagId: string) {
    const next = filters.tagIds.includes(tagId)
      ? filters.tagIds.filter((id) => id !== tagId)
      : [...filters.tagIds, tagId];
    update({ tagIds: next });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
          activeCount > 0 && "text-primary",
        )}
      >
        <Filter className="h-3 w-3" />
        {activeCount > 0 ? t("filtersCount", { count: activeCount }) : t("filters")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-foreground">{t("filters")}</p>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_CONVERSATION_FILTERS)}
              className="text-xs text-muted-foreground hover:text-primary"
            >
              {t("clearFilters")}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("assignedTo")}
              </label>
              <select
                value={filters.assignedTo ?? ""}
                onChange={(e) => update({ assignedTo: e.target.value || null })}
                className="h-8 w-full rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
              >
                <option value="">{t("any")}</option>
                <option value="unassigned">{t("unassigned")}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.user_id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("stage")}
              </label>
              <select
                value={filters.stageId ?? ""}
                onChange={(e) => update({ stageId: e.target.value || null })}
                className="h-8 w-full rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
              >
                <option value="">{t("any")}</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("dealStatus")}
              </label>
              <select
                value={filters.dealStatus ?? ""}
                onChange={(e) =>
                  update({ dealStatus: (e.target.value || null) as DealStatusFilter | null })
                }
                className="h-8 w-full rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
              >
                <option value="">{t("any")}</option>
                <option value="open">{t("dealOpen")}</option>
                <option value="won">{t("dealWon")}</option>
                <option value="lost">{t("dealLost")}</option>
                <option value="none">{t("dealNone")}</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("tags")}
              </label>
              {tags.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("noTagsAvailable")}</p>
              ) : (
                <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                  {tags.map((tag) => {
                    const selected = filters.tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity",
                          !selected && "opacity-50 hover:opacity-80",
                        )}
                        style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("date")}
              </label>
              <select
                value={filters.dateRange ?? ""}
                onChange={(e) =>
                  update({ dateRange: (e.target.value || null) as DateRangeFilter | null })
                }
                className="h-8 w-full rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
              >
                <option value="">{t("any")}</option>
                <option value="today">{t("dateToday")}</option>
                <option value="week">{t("dateWeek")}</option>
                <option value="month">{t("dateMonth")}</option>
              </select>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
