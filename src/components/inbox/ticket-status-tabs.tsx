"use client";

import { useTranslations } from "next-intl";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";

export type TicketTab = "all" | "unread" | "pending" | "in_progress" | "closed" | "no_ticket";

export interface TicketTabCounts {
  all: number;
  unread: number;
  pending: number;
  in_progress: number;
  /** null while the (lazy, count-only) closed-tickets count hasn't
   *  resolved yet — renders without a badge rather than "0". */
  closed: number | null;
  no_ticket: number;
}

const TABS: { value: TicketTab; labelKey: string }[] = [
  { value: "all", labelKey: "all" },
  { value: "unread", labelKey: "unread" },
  { value: "pending", labelKey: "pending" },
  { value: "in_progress", labelKey: "inProgress" },
  { value: "closed", labelKey: "closed" },
  { value: "no_ticket", labelKey: "noTicket" },
];

/**
 * Settings → Atendimento's rail uses the same "horizontal scroller on
 * mobile, no wrapping" trick (overflow-x-auto + hidden scrollbar) —
 * reused here so the 6 tabs + the "only mine" chip stay usable on a
 * phone-width inbox without wrapping into a second line that eats
 * vertical space from the conversation list below it.
 */
export function TicketStatusTabs({
  value,
  onChange,
  counts,
  onlyMine,
  onToggleOnlyMine,
}: {
  value: TicketTab;
  onChange: (tab: TicketTab) => void;
  counts: TicketTabCounts;
  onlyMine: boolean;
  onToggleOnlyMine: () => void;
}) {
  const t = useTranslations("inbox.tickets.tabs");

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map((tab) => {
        const count = counts[tab.value];
        const isActive = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              isActive
                ? "bg-primary-soft text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(tab.labelKey)}
            {count != null && count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] tabular-nums",
                  isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onToggleOnlyMine}
        aria-pressed={onlyMine}
        className={cn(
          "ml-1 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors",
          onlyMine
            ? "bg-primary-soft text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <User className="size-3" />
        {t("onlyMine")}
      </button>
    </div>
  );
}
