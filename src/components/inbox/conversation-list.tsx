"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { localeToDateFns, type Locale } from "@/i18n/locales";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePaginatedInboxList } from "@/hooks/use-paginated-inbox-list";
import { useInboxTabCounts } from "@/hooks/use-inbox-tab-counts";
import { resolveAllTabConversationIds } from "@/lib/inbox/resolve-tab-conversation-ids";
import type { BulkAction } from "@/lib/inbox/bulk-action-client";
import { cn } from "@/lib/utils";
import { TICKET_PROTOCOL_UI_ENABLED } from "@/lib/feature-flags";
import type {
  Contact,
  Conversation,
  ConversationStatus,
  Profile,
  WhatsAppChannelOption,
} from "@/types";
import {
  Search,
  ChevronDown,
  CheckSquare,
  Square,
  X,
  Mail,
  MailOpen,
  Archive,
  ArrowRightLeft,
  UserPlus,
  Smartphone,
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
import { TicketStatusTabs, type TicketTab } from "./ticket-status-tabs";
import { BulkActionDialog } from "./bulk-action-dialog";

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
  /** Bumped (debounced ~400ms) by the page on every realtime
   *  message/conversation/ticket event — feeds the four ticket
   *  tabs' pagination + counts (see usePaginatedInboxList's doc
   *  comment) so a new message or a ticket status change shows up
   *  without a manual reload. The legacy (non-ticket) list doesn't
   *  need this: it already live-patches via the `conversations`
   *  prop, which inbox/page.tsx's realtime handlers update directly. */
  inboxActivityToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};

type InboxFilter = ConversationStatus | "all" | "unread";

/** Persists the selected channel filter across sessions, same key
 *  convention as the other inbox localStorage reads/writes. */
const CHANNEL_FILTER_STORAGE_KEY = "wacrm:inbox:channelFilter";

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
  inboxActivityToken = 0,
}: ConversationListProps) {
  const t = useTranslations("inbox.list");
  const tBulk = useTranslations("inbox.bulk");
  const { ticketsUiEnabled, user, accountId, profileLoading } = useAuth();
  const [search, setSearch] = useState("");
  // Default to "open" for the legacy (non-tickets) dropdown; "Ativos"
  // (in_progress) for the ticket tabs. `profileLoading` is what
  // actually tells us ticketsUiEnabled has resolved its real value —
  // it starts `false` optimistically before the profile fetch
  // settles, so branching on `ticketsUiEnabled` directly here would
  // misfire on every mount. The one-shot effect below applies the
  // right default exactly once, right when that resolution lands.
  const [filter, setFilter] = useState<InboxFilter | TicketTab>("open");
  const appliedDefaultRef = useRef(false);
  useEffect(() => {
    if (!profileLoading && !appliedDefaultRef.current) {
      appliedDefaultRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilter(ticketsUiEnabled ? "in_progress" : "open");
    }
  }, [profileLoading, ticketsUiEnabled]);

  // "Não lidas" and "Só os meus" — plain toggles alongside the tabs,
  // not tabs themselves (see ticket-status-tabs.tsx's doc comment).
  // Both apply on top of whichever tab is active.
  const [unreadOnly, setUnreadOnly] = useState(false);
  const handleToggleUnreadOnly = useCallback(() => setUnreadOnly((v) => !v), []);
  const [onlyMine, setOnlyMine] = useState(false);
  const handleToggleOnlyMine = useCallback(() => setOnlyMine((v) => !v), []);

  const [advancedFilters, setAdvancedFilters] = useState<ConversationFiltersState>(
    EMPTY_CONVERSATION_FILTERS,
  );
  const [loading, setLoading] = useState(true);

  // Channel filter — `null` means "Todos os canais" (default). Read from
  // localStorage in an effect (not the initializer) to avoid a hydration
  // mismatch, same pattern as CONTACT_PANEL_STORAGE_KEY in inbox/page.tsx.
  const [channelFilter, setChannelFilterState] = useState<string | null>(null);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CHANNEL_FILTER_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setChannelFilterState(stored);
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);
  const setChannelFilter = useCallback((channelId: string | null) => {
    setChannelFilterState(channelId);
    try {
      if (channelId) localStorage.setItem(CHANNEL_FILTER_STORAGE_KEY, channelId);
      else localStorage.removeItem(CHANNEL_FILTER_STORAGE_KEY);
    } catch {
      // Persistence is best-effort; ignore storage failures.
    }
  }, []);

  // Multi-select — active whenever at least one conversation is
  // checked. Bulk actions write straight to Supabase; the parent
  // page's existing realtime subscription (inbox/page.tsx) picks up
  // the resulting UPDATE events and patches `conversations`, so this
  // component doesn't need its own copy of the list to stay in sync.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Profile[]>([]);

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

  // Active channels on the account — drives both the per-row channel
  // badge (only worth showing once there's more than one number to
  // disambiguate between) and the channel filter dropdown.
  const [channels, setChannels] = useState<WhatsAppChannelOption[]>([]);
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("whatsapp_channels")
      .select("id, name, display_phone_number, is_default, channel_type")
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .then(({ data }) => setChannels((data as WhatsAppChannelOption[] | null) ?? []));
  }, []);
  const multiChannel = channels.length > 1;

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
  // Bumped after a bulk action completes on the legacy (non-ticket)
  // path to force the fetch effect below to refire — it has no
  // RPC-backed `refresh()` of its own to call instead (see
  // handleBulkDone further down).
  const [legacyReloadToken, setLegacyReloadToken] = useState(0);

  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    // Wait for the profile fetch to resolve ticketsUiEnabled before
    // this ever runs — otherwise it fires once optimistically with
    // the flag `false` (no join) and a second time once the real
    // value lands, doubling the work on every mount. One fetch,
    // already correct, per the approved fix.
    if (profileLoading) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "*, contact:contacts(*, contact_tags(tag_id), deals(status, stage_id)), channel:whatsapp_channels(name, display_phone_number, channel_type)",
        )
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

      // No ticket join here anymore — the four ticket tabs render
      // from usePaginatedInboxList (migration 075's RPC), not from
      // this array. This fetch still has to run for every account
      // (ticketsUiEnabled or not): `conversations` is what
      // inbox/page.tsx uses to resolve `?c=<id>` deep links and as
      // the patch target for realtime conversation/message events —
      // the active-thread plumbing, independent of what the list
      // displays. Known limitation carried over unchanged: still
      // capped at PostgREST's default 1000 rows, so a deep link to a
      // conversation outside the 1000 most-recently-active ones won't
      // auto-select — same as before this fix, not something the
      // approved plan asked to resolve today.
      onConversationsLoadedRef.current((data ?? []) as Conversation[]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
    // `profileLoading` is included so this waits for ticketsUiEnabled
    // to resolve before the legacy `filtered` memo below ever runs —
    // same reasoning as before, now only gating the legacy path.
    // `legacyReloadToken` is bumped after a bulk action completes on
    // the legacy (non-ticket) path, which has no RPC-backed `refresh()`
    // of its own to call instead.
  }, [resyncToken, profileLoading, legacyReloadToken]);

  // Legacy (non-ticket) path only — when ticketsUiEnabled, the list
  // renders from usePaginatedInboxList instead (server-side filtered
  // and paginated; see migration 075). This memo and the fetch
  // feeding it stay exactly as they were for accounts still on the
  // pre-tickets inbox.
  const filtered = useMemo(() => {
    let result = conversations;

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter !== "all" && !ticketsUiEnabled) {
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

    if (channelFilter) {
      result = result.filter((c) => c.channel_id === channelFilter);
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
  }, [conversations, filter, search, advancedFilters, channelFilter, ticketsUiEnabled]);

  // Fase 1 (atendimento) — the four ticket tabs, server-paginated via
  // migration 075's RPCs (see the hooks' own doc comments for why:
  // the old "fetch everything, filter in memory" model silently
  // capped at PostgREST's default 1000-row limit — that's what the
  // "Sem atendimento" counter stuck at 1000 was).
  const paginatedList = usePaginatedInboxList({
    enabled: ticketsUiEnabled,
    accountId,
    tab: filter as TicketTab,
    userId: user?.id,
    onlyMine,
    unreadOnly,
    channelId: channelFilter,
    search,
    resyncToken,
    activityToken: inboxActivityToken,
  });
  const inboxCounts = useInboxTabCounts({
    enabled: ticketsUiEnabled,
    accountId,
    userId: user?.id,
    onlyMine,
    unreadOnly,
    resyncToken,
    activityToken: inboxActivityToken,
  });

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

  // "Selecionar todos" — two modes. "page": every conversation
  // currently loaded (this page/batch of the active tab) — a
  // concrete id set, same as checking every box by hand. "allMatching":
  // every conversation matching the active tab + filters, including
  // whatever hasn't loaded yet — resolved server-side only once the
  // bulk action actually runs (see getTargetIds below), never as an
  // upfront id list in state. Only offered for the four ticket tabs,
  // which is what migration 075's RPC can resolve; the legacy
  // (non-ticket) tabs keep "select everything currently loaded" as
  // their ceiling, same as before this fix.
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const selectionActive = selectedIds.size > 0 || selectAllMatching;

  const currentLoadedIds = useMemo(
    () => (ticketsUiEnabled ? paginatedList.items.map((c) => c.id) : filtered.map((c) => c.id)),
    [ticketsUiEnabled, paginatedList.items, filtered],
  );
  const allLoadedSelected =
    currentLoadedIds.length > 0 && currentLoadedIds.every((id) => selectedIds.has(id));
  const totalForActiveTab = ticketsUiEnabled
    ? inboxCounts.counts[filter as TicketTab]
    : filtered.length;

  const handleToggleSelectAllLoaded = useCallback(() => {
    setSelectAllMatching(false);
    setSelectedIds((prev) => {
      if (currentLoadedIds.length > 0 && currentLoadedIds.every((id) => prev.has(id))) {
        return new Set();
      }
      return new Set(currentLoadedIds);
    });
  }, [currentLoadedIds]);

  const handleSelectAllMatching = useCallback(() => {
    setSelectAllMatching(true);
  }, []);

  const handleCancelSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }, []);

  // Bulk action dialog — one flow for every action, both inboxes.
  // See bulk-action-dialog.tsx's doc comment.
  const [bulkDialog, setBulkDialog] = useState<{
    action: BulkAction;
    presetPayload?: Record<string, unknown>;
  } | null>(null);

  const openBulkAction = useCallback(
    (action: BulkAction, presetPayload?: Record<string, unknown>) => {
      setBulkDialog({ action, presetPayload });
    },
    [],
  );

  const getBulkTargetIds = useCallback(async (): Promise<string[]> => {
    if (selectAllMatching && ticketsUiEnabled && accountId) {
      return resolveAllTabConversationIds({
        accountId,
        tab: filter as TicketTab,
        userId: user?.id,
        onlyMine,
        unreadOnly,
        channelId: channelFilter,
        search,
      });
    }
    return Array.from(selectedIds);
  }, [selectAllMatching, ticketsUiEnabled, accountId, filter, user?.id, onlyMine, unreadOnly, channelFilter, search, selectedIds]);

  const handleBulkDone = useCallback(() => {
    setSelectedIds(new Set());
    setSelectAllMatching(false);
    inboxCounts.refresh();
    if (ticketsUiEnabled) {
      paginatedList.refresh();
    } else {
      setLegacyReloadToken((n) => n + 1);
    }
  }, [ticketsUiEnabled, inboxCounts, paginatedList]);

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);
  const activeFilterLabel = activeFilter ? t(activeFilter.labelKey) : t("all");
  const activeChannelLabel = channelFilter
    ? channels.find((c) => c.id === channelFilter)?.name ?? t("allChannels")
    : t("allChannels");

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Search + Filter, or the bulk-action bar while conversations are selected. */}
      {selectionActive ? (
        <div className="space-y-2 border-b border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={handleCancelSelection}
                aria-label={t("cancelSelection")}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleToggleSelectAllLoaded}
                aria-label={t("selectAllLoaded")}
                title={t("selectAllLoaded")}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {allLoadedSelected || selectAllMatching ? (
                  <CheckSquare className="h-4 w-4" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
              </button>
              <span className="truncate text-xs font-medium text-foreground">
                {selectAllMatching
                  ? tBulk("allSelected", { count: totalForActiveTab })
                  : t("selectedCount", { count: selectedIds.size })}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => openBulkAction("mark_read")}
                disabled={bulkDialog !== null}
                aria-label={t("markSelectedRead")}
                title={t("markSelectedRead")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <MailOpen className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => openBulkAction("mark_unread")}
                disabled={bulkDialog !== null}
                aria-label={t("markSelectedUnread")}
                title={t("markSelectedUnread")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <Mail className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => openBulkAction("close")}
                disabled={bulkDialog !== null}
                aria-label={t("closeSelected")}
                title={t("closeSelected")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
              {ticketsUiEnabled && (
                <button
                  type="button"
                  onClick={() => openBulkAction("transfer")}
                  disabled={bulkDialog !== null}
                  aria-label={tBulk("transfer")}
                  title={tBulk("transfer")}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={bulkDialog !== null}
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
                        onClick={() => openBulkAction("assign", { agentId: p.user_id })}
                        className="text-sm text-popover-foreground"
                      >
                        {p.full_name || p.email}
                      </DropdownMenuItem>
                    ))
                  )}
                  <DropdownMenuItem
                    onClick={() => openBulkAction("return_to_queue")}
                    className="text-sm text-muted-foreground"
                  >
                    {t("unassignSelected")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {ticketsUiEnabled && !selectAllMatching && totalForActiveTab > currentLoadedIds.length && (
            <button
              type="button"
              onClick={handleSelectAllMatching}
              className="text-xs font-medium text-primary hover:underline"
            >
              {tBulk("selectAllMatching", { count: totalForActiveTab })}
            </button>
          )}
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

          {ticketsUiEnabled && (
            <TicketStatusTabs
              value={filter as TicketTab}
              onChange={setFilter}
              counts={inboxCounts.counts}
              unreadOnly={unreadOnly}
              onToggleUnreadOnly={handleToggleUnreadOnly}
              onlyMine={onlyMine}
              onToggleOnlyMine={handleToggleOnlyMine}
            />
          )}

          <div className="flex items-center gap-1">
            {!ticketsUiEnabled && (
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
            )}

            {multiChannel && (
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 max-w-[7rem] gap-1 truncate px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                  <Smartphone className="h-3 w-3 shrink-0" />
                  <span className="truncate">{activeChannelLabel}</span>
                  <ChevronDown className="h-3 w-3 shrink-0" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="border-border bg-popover">
                  <DropdownMenuItem
                    onClick={() => setChannelFilter(null)}
                    className={cn(
                      "text-sm",
                      channelFilter === null ? "text-primary" : "text-popover-foreground"
                    )}
                  >
                    {t("allChannels")}
                  </DropdownMenuItem>
                  {channels.map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      onClick={() => setChannelFilter(c.id)}
                      className={cn(
                        "text-sm",
                        channelFilter === c.id ? "text-primary" : "text-popover-foreground"
                      )}
                    >
                      {c.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <ConversationFiltersPopover filters={advancedFilters} onChange={setAdvancedFilters} />
          </div>
        </div>
      )}

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this list grows to fit every
          conversation instead of shrinking to the remaining space —
          it then overflows and gets clipped by the parent's
          overflow-hidden with no scrollbar (issue #229). */}
      {ticketsUiEnabled ? (
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            // "carregar mais ao rolar" — 150px from the bottom is
            // close enough to start the next page before the user
            // actually hits the end and sees a blank gap.
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
              paginatedList.loadMore();
            }
          }}
        >
          {paginatedList.loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : paginatedList.items.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm text-muted-foreground">{t("noConversationsFound")}</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {paginatedList.items.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conversation={conv}
                  isActive={conv.id === activeConversationId}
                  onSelect={handleSelect}
                  selectionActive={selectionActive}
                  selected={selectedIds.has(conv.id)}
                  onToggleSelect={handleToggleSelect}
                  showChannel={multiChannel}
                />
              ))}
              {paginatedList.loadingMore && (
                <div className="flex items-center justify-center py-4">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
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
                  showChannel={multiChannel}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      )}

      {bulkDialog && (
        <BulkActionDialog
          open
          onOpenChange={(open) => !open && setBulkDialog(null)}
          action={bulkDialog.action}
          ticketsUiEnabled={ticketsUiEnabled}
          targetCount={selectAllMatching ? totalForActiveTab : selectedIds.size}
          profiles={profiles}
          currentUserId={user?.id}
          presetPayload={bulkDialog.presetPayload}
          getTargetIds={getBulkTargetIds}
          onDone={handleBulkDone}
        />
      )}
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
  /** Only render the per-row channel badge when the account has more
   *  than one active WhatsApp number. */
  showChannel: boolean;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  selectionActive,
  selected,
  onToggleSelect,
  showChannel,
}: ConversationItemProps) {
  const t = useTranslations("inbox.list");
  const locale = useLocale() as Locale;
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
        locale: localeToDateFns(locale),
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
      <div
        className={cn(
          "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-medium",
          isActive ? "bg-primary-soft text-primary" : "bg-card-2 text-foreground",
        )}
      >
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
          {TICKET_PROTOCOL_UI_ENABLED && conversation.ticket && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              #{conversation.ticket.protocol_number}
            </span>
          )}
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{timeAgo}</span>
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
            {showChannel && conversation.channel?.name && (
              <span
                className="flex items-center gap-0.5 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground"
                title={conversation.channel.display_phone_number ?? conversation.channel.name}
              >
                <Smartphone className="h-2.5 w-2.5" />
                {conversation.channel.name}
              </span>
            )}
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-bold text-primary-foreground">
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
