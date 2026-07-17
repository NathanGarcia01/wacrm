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
import type { BroadcastStatus, Tag } from "@/types";
import type { PeriodKey } from "@/lib/reports/types";

export interface WhatsAppChannelOption {
  id: string;
  name: string;
  display_phone_number?: string | null;
  is_active: boolean;
}

export interface BroadcastFilters {
  status: BroadcastStatus | "all";
  /** ANY-match against the broadcast's audience_filter.tagIds. */
  tagIds: string[];
  /** "all" = no date restriction. Filters each broadcast by its
   *  "effective date" — scheduled_at if set, else created_at. */
  periodKey: PeriodKey | "all";
  customFrom?: string;
  customTo?: string;
  channelId: string; // "" = all
}

export const DEFAULT_BROADCAST_FILTERS: BroadcastFilters = {
  status: "all",
  tagIds: [],
  periodKey: "all",
  channelId: "",
};

export function countActiveBroadcastFilters(filters: BroadcastFilters): number {
  let count = 0;
  if (filters.status !== "all") count += 1;
  if (filters.tagIds.length > 0) count += 1;
  if (filters.periodKey !== "all") count += 1;
  if (filters.channelId !== "") count += 1;
  return count;
}

interface BroadcastFilterBarProps {
  filters: BroadcastFilters;
  onChange: (filters: BroadcastFilters) => void;
  tags: Tag[];
  channels: WhatsAppChannelOption[];
}

export function BroadcastFilterBar({
  filters,
  onChange,
  tags,
  channels,
}: BroadcastFilterBarProps) {
  const t = useTranslations("broadcasts.list.filters");
  const tStatus = useTranslations("broadcasts.status");
  const activeCount = countActiveBroadcastFilters(filters);

  function toggleTag(tagId: string) {
    const next = filters.tagIds.includes(tagId)
      ? filters.tagIds.filter((id) => id !== tagId)
      : [...filters.tagIds, tagId];
    onChange({ ...filters, tagIds: next });
  }

  // Base UI's <Select> only resolves the trigger's displayed label from
  // its `items` map up front — see pipeline-filter-bar.tsx for the same
  // note. Kept consistent here.
  const statusItems = useMemo(
    () => ({
      all: t("statusAll"),
      draft: tStatus("draft"),
      scheduled: tStatus("scheduled"),
      sending: tStatus("sending"),
      paused: tStatus("paused"),
      sent: tStatus("sent"),
      failed: tStatus("failed"),
    }),
    [t, tStatus],
  );
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
  const channelItems = useMemo(() => {
    const items: Record<string, string> = { __all__: t("channelAll") };
    for (const c of channels) {
      items[c.id] = c.display_phone_number ? `${c.name} (${c.display_phone_number})` : c.name;
    }
    return items;
  }, [t, channels]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/60 p-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("statusLabel")}</label>
        <Select
          items={statusItems}
          value={filters.status}
          onValueChange={(v) => onChange({ ...filters, status: v as BroadcastStatus | "all" })}
        >
          <SelectTrigger className="w-40 bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("statusAll")}</SelectItem>
            <SelectItem value="draft">{tStatus("draft")}</SelectItem>
            <SelectItem value="scheduled">{tStatus("scheduled")}</SelectItem>
            <SelectItem value="sending">{tStatus("sending")}</SelectItem>
            <SelectItem value="paused">{tStatus("paused")}</SelectItem>
            <SelectItem value="sent">{tStatus("sent")}</SelectItem>
            <SelectItem value="failed">{tStatus("failed")}</SelectItem>
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
                className="h-9 w-52 justify-between border-border bg-muted font-normal text-foreground"
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
            onChange({ ...filters, periodKey: (v || "all") as BroadcastFilters["periodKey"] })
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

      {channels.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("channelLabel")}</label>
          <Select
            items={channelItems}
            value={filters.channelId === "" ? "__all__" : filters.channelId}
            onValueChange={(v) =>
              onChange({ ...filters, channelId: !v || v === "__all__" ? "" : v })
            }
          >
            <SelectTrigger className="w-48 bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("channelAll")}</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.display_phone_number ? `${c.name} (${c.display_phone_number})` : c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {activeCount > 0 && (
        <div className="ml-auto flex items-center gap-2 self-end">
          <Badge variant="secondary">{t("activeFilters", { count: activeCount })}</Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(DEFAULT_BROADCAST_FILTERS)}
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
