"use client";

import { useTranslations } from "next-intl";
import { Mail, MailOpen, User } from "lucide-react";
import { cn } from "@/lib/utils";

export type TicketTab = "pending" | "in_progress" | "closed" | "no_ticket";

export interface TicketTabCounts {
  pending: number;
  in_progress: number;
  closed: number;
  no_ticket: number;
}

const TABS: { value: TicketTab; labelKey: string }[] = [
  { value: "pending", labelKey: "pending" },
  { value: "in_progress", labelKey: "inProgress" },
  { value: "closed", labelKey: "closed" },
  { value: "no_ticket", labelKey: "noTicket" },
];

/**
 * Fase 1 (atendimento) Etapa 6 fix — 4 tabs laid out in a fixed
 * `grid-cols-4` (not a horizontally-scrolling row) so all of them
 * are visible at the list's current width without scrolling, per
 * the approved fix. "Não lidas" and "Só os meus" moved out of the
 * tab strip entirely into a secondary row of plain toggles — they're
 * filters orthogonal to the active tab, not tabs themselves, and
 * keeping them separate is what freed up the room for the 4 tabs to
 * fit without truncating ("Sem atendimento" still truncates at this
 * width if the browser's font metrics run wide — `truncate` turns
 * that into an ellipsis instead of visually cut-off text).
 */
export function TicketStatusTabs({
  value,
  onChange,
  counts,
  unreadOnly,
  onToggleUnreadOnly,
  onlyMine,
  onToggleOnlyMine,
}: {
  value: TicketTab;
  onChange: (tab: TicketTab) => void;
  counts: TicketTabCounts;
  unreadOnly: boolean;
  onToggleUnreadOnly: () => void;
  onlyMine: boolean;
  onToggleOnlyMine: () => void;
}) {
  const t = useTranslations("inbox.tickets.tabs");

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-4 gap-1">
        {TABS.map((tab) => {
          const count = counts[tab.value];
          const isActive = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange(tab.value)}
              aria-current={isActive ? "page" : undefined}
              title={t(tab.labelKey)}
              className={cn(
                "flex min-w-0 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 transition-colors",
                isActive
                  ? "bg-primary-soft text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="w-full truncate text-center text-[11px] font-medium">
                {t(tab.labelKey)}
              </span>
              <span className="text-[10px] tabular-nums opacity-80">{count ?? ""}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleUnreadOnly}
          aria-pressed={unreadOnly}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors",
            unreadOnly
              ? "bg-primary-soft text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {unreadOnly ? <MailOpen className="size-3" /> : <Mail className="size-3" />}
          {t("unreadOnly")}
        </button>
        <button
          type="button"
          onClick={onToggleOnlyMine}
          aria-pressed={onlyMine}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors",
            onlyMine
              ? "bg-primary-soft text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <User className="size-3" />
          {t("onlyMine")}
        </button>
      </div>
    </div>
  );
}
