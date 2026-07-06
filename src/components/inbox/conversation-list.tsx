"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Contact, Conversation, ConversationStatus, Profile } from "@/types";
import {
  Search,
  ChevronDown,
  X,
  Mail,
  MailOpen,
  Archive,
  UserPlus,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ConversationFiltersPopover,
  EMPTY_CONVERSATION_FILTERS,
  type ConversationFiltersState,
} from "./conversation-filters";

/** Extra joins fetched only for client-side filtering — not part of the
 *  shared `Contact` type since nothing outside this filter logic needs them. */
type ContactWithFilterJoins = Contact & {
  contact_tags?: { tag_id: string }[];
  deals?: { status: string | null; stage_id: string }[];
};

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};

type InboxFilter = ConversationStatus | "all" | "unread";

const FILTER_OPTIONS: { labelKey: string; value: InboxFilter }[] = [
  { labelKey: "all", value: "all" },
  { labelKey: "unread", value: "unread" },
  { labelKey: "open", value: "open" },
  { labelKey: "pending", value: "pending" },
  { labelKey: "closed", value: "closed" },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const t = useTranslations("inbox.list");
  const [search, setSearch] = useState("");
  // Default to "open" — closed conversations are done-and-archived, so
  // they shouldn't compete for attention unless explicitly requested.
  const [filter, setFilter] = useState<InboxFilter>("open");
  const [advancedFilters, setAdvancedFilters] = useState<ConversationFiltersState>(
    EMPTY_CONVERSATION_FILTERS,
  );
  const [loading, setLoading] = useState(true);

  // Multi-select — active whenever at least one conversation is
  // checked. Bulk actions write straight to Supabase; the parent
  // page's existing realtime subscription (inbox/page.tsx) picks up
  // the resulting UPDATE events and patches `conversations`, so this
  // component doesn't need its own copy of the list to stay in sync.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [bulkActing, setBulkActing] = useState(false);
  const selectionActive = selectedIds.size > 0;

  // Account members for the bulk "assign" action. RLS scopes this to
  // the caller's own account, same as the assign dropdown in
  // message-thread.tsx — no explicit account_id filter needed.
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data }) => setProfiles((data ?? []) as Profile[]));
  }, []);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, contact:contacts(*, contact_tags(tag_id), deals(status, stage_id))")
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    if (advancedFilters.assignedTo) {
      result = result.filter((c) =>
        advancedFilters.assignedTo === "unassigned"
          ? !c.assigned_agent_id
          : c.assigned_agent_id === advancedFilters.assignedTo,
      );
    }

    if (advancedFilters.stageId || advancedFilters.dealStatus) {
      result = result.filter((c) => {
        const deals = (c.contact as ContactWithFilterJoins | undefined)?.deals ?? [];
        if (advancedFilters.dealStatus === "none" && deals.length > 0) return false;
        if (
          advancedFilters.dealStatus &&
          advancedFilters.dealStatus !== "none" &&
          !deals.some((d) => (d.status ?? "open") === advancedFilters.dealStatus)
        ) {
          return false;
        }
        if (advancedFilters.stageId && !deals.some((d) => d.stage_id === advancedFilters.stageId)) {
          return false;
        }
        return true;
      });
    }

    if (advancedFilters.tagIds.length > 0) {
      result = result.filter((c) => {
        const contactTags = (c.contact as ContactWithFilterJoins | undefined)?.contact_tags ?? [];
        const ids = new Set(contactTags.map((ct) => ct.tag_id));
        return advancedFilters.tagIds.every((id) => ids.has(id));
      });
    }

    if (advancedFilters.dateRange) {
      const from = new Date();
      if (advancedFilters.dateRange === "today") {
        from.setHours(0, 0, 0, 0);
      } else if (advancedFilters.dateRange === "week") {
        from.setDate(from.getDate() - 7);
      } else {
        from.setMonth(from.getMonth() - 1);
      }
      result = result.filter(
        (c) => !!c.last_message_at && new Date(c.last_message_at) >= from,
      );
    }

    return result;
  }, [conversations, filter, search, advancedFilters]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCancelSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const runBulkUpdate = useCallback(
    async (patch: Record<string, unknown>) => {
      if (selectedIds.size === 0) return;
      setBulkActing(true);
      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update(patch)
        .in("id", Array.from(selectedIds));
      setBulkActing(false);
      if (error) {
        console.error("Bulk conversation update failed:", error);
        return;
      }
      setSelectedIds(new Set());
    },
    [selectedIds]
  );

  const handleMarkSelectedRead = useCallback(
    () => runBulkUpdate({ unread_count: 0 }),
    [runBulkUpdate]
  );
  const handleMarkSelectedUnread = useCallback(
    () => runBulkUpdate({ unread_count: 1 }),
    [runBulkUpdate]
  );
  const handleCloseSelected = useCallback(
    () => runBulkUpdate({ status: "closed" satisfies ConversationStatus }),
    [runBulkUpdate]
  );
  const handleAssignSelected = useCallback(
    (agentId: string | null) => runBulkUpdate({ assigned_agent_id: agentId }),
    [runBulkUpdate]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);
  const activeFilterLabel = activeFilter ? t(activeFilter.labelKey) : t("all");

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Search + Filter, or the bulk-action bar while conversations are selected. */}
      {selectionActive ? (
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={handleCancelSelection}
              aria-label={t("cancelSelection")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <span className="truncate text-xs font-medium text-foreground">
              {t("selectedCount", { count: selectedIds.size })}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={handleMarkSelectedRead}
              disabled={bulkActing}
              aria-label={t("markSelectedRead")}
              title={t("markSelectedRead")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <MailOpen className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleMarkSelectedUnread}
              disabled={bulkActing}
              aria-label={t("markSelectedUnread")}
              title={t("markSelectedUnread")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <Mail className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCloseSelected}
              disabled={bulkActing}
              aria-label={t("closeSelected")}
              title={t("closeSelected")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={bulkActing}
                aria-label={t("assignSelected")}
                title={t("assignSelected")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-border bg-popover">
                {profiles.length === 0 ? (
                  <DropdownMenuItem disabled className="text-sm text-muted-foreground">
                    {t("noMembersAvailable")}
                  </DropdownMenuItem>
                ) : (
                  profiles.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => handleAssignSelected(p.user_id)}
                      className="text-sm text-popover-foreground"
                    >
                      {p.full_name || p.email}
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuItem
                  onClick={() => handleAssignSelected(null)}
                  className="text-sm text-muted-foreground"
                >
                  {t("unassignSelected")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : (
        <div className="space-y-2 border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={handleSearchChange}
              placeholder={t("searchPlaceholder")}
              className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
            />
          </div>

          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                  {activeFilterLabel}
                  <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="border-border bg-popover"
              >
                {FILTER_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    onClick={() => setFilter(opt.value)}
                    className={cn(
                      "text-sm",
                      filter === opt.value
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    {t(opt.labelKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <ConversationFiltersPopover filters={advancedFilters} onChange={setAdvancedFilters} />
          </div>
        </div>
      )}

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("noConversationsFound")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                selectionActive={selectionActive}
                selected={selectedIds.has(conv.id)}
                onToggleSelect={handleToggleSelect}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  selectionActive: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  selectionActive,
  selected,
  onToggleSelect,
}: ConversationItemProps) {
  const t = useTranslations("inbox.list");
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknownContact");
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const handleToggle = useCallback(() => {
    onToggleSelect(conversation.id);
  }, [onToggleSelect, conversation.id]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  const isUnread = conversation.unread_count > 0;

  return (
    <div
      className={cn(
        "group relative flex w-full items-stretch transition-colors hover:bg-muted/50",
        isUnread && !isActive && "bg-primary/[0.04]",
        isActive && "border-l-2 border-primary bg-muted/70"
      )}
    >
      {/* Selection checkbox — hidden until hover, unless the row (or
          any other row) is already selected, in which case it stays
          visible so the checked state is always legible. Kept as a
          sibling of the row button (not nested inside it) since a
          <button> can't contain another interactive control. */}
      <div
        className={cn(
          "flex items-center pl-3 transition-opacity",
          selectionActive || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
      >
        <Checkbox
          checked={selected}
          onCheckedChange={handleToggle}
          aria-label={t("selectConversation", { name: displayName })}
        />
      </div>

      <button
        onClick={handleClick}
        className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left"
      >
      {/* Avatar */}
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          initials
        )}
        {isUnread && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary"
          />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "truncate text-sm text-foreground",
              isUnread ? "font-semibold" : "font-medium"
            )}
          >
            {displayName}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p
            className={cn(
              "truncate text-xs",
              isUnread ? "font-medium text-foreground" : "text-muted-foreground"
            )}
          >
            {conversation.last_message_text || t("noMessagesYet")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
      </div>
      </button>
    </div>
  );
}
