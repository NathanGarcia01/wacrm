"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Conversation } from "@/types";
import type { TicketTab } from "@/components/inbox/ticket-status-tabs";

const PAGE_SIZE = 30;

export interface UsePaginatedInboxListParams {
  enabled: boolean;
  accountId: string | null;
  tab: TicketTab;
  userId?: string | null;
  onlyMine: boolean;
  unreadOnly: boolean;
  channelId?: string | null;
  search: string;
  /** Bumped by the page on WS reconnect / tab refocus — same signal
   *  every other inbox fetch already reacts to. Resets to page 1. */
  resyncToken?: number;
  /** Bumped by the page (debounced) on every realtime message/
   *  conversation/ticket event — see inbox/page.tsx's
   *  `bumpInboxActivity`. Refetches page 1 of whichever tab is
   *  active, which is what makes a new message "jump the conversation
   *  to the top" (pending/in_progress are ordered by
   *  conversations.last_message_at — see migration 075) and makes a
   *  ticket crossing into/out of the active tab's status show up
   *  without a manual reload. Resets to page 1, same as resyncToken —
   *  trades "preserve scrolled-in pages" for always-correct tab
   *  membership, since a shrinking/growing result set can't be
   *  patched in place without risking duplicate or missing rows. */
  activityToken?: number;
}

export interface UsePaginatedInboxListResult {
  items: Conversation[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  refresh: () => void;
}

/**
 * Fase 1 (atendimento) — backs the four ticket tabs (Pendentes/
 * Ativos/Fechados/Sem atendimento) via `list_inbox_tab_conversations`
 * (migration 075), paginated server-side instead of the old
 * "fetch everything, filter in memory" model that silently capped at
 * PostgREST's default 1000-row limit.
 */
export function usePaginatedInboxList({
  enabled,
  accountId,
  tab,
  userId,
  onlyMine,
  unreadOnly,
  channelId,
  search,
  resyncToken = 0,
  activityToken = 0,
}: UsePaginatedInboxListParams): UsePaginatedInboxListResult {
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Debounce search like the old client-side filter never had to —
  // here every keystroke would otherwise be a round trip.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const offsetRef = useRef(0);
  const requestIdRef = useRef(0);

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      if (!enabled || !accountId) return;
      const requestId = ++requestIdRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("list_inbox_tab_conversations", {
        p_account_id: accountId,
        p_tab: tab,
        p_user_id: userId ?? null,
        p_only_mine: onlyMine,
        p_unread_only: unreadOnly,
        p_channel_id: channelId ?? null,
        p_search: debouncedSearch || null,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      });

      // A newer request already superseded this one (filters changed
      // mid-flight) — drop this result rather than let it clobber
      // fresher state.
      if (requestId !== requestIdRef.current) return;

      if (rpcError) {
        console.error("[usePaginatedInboxList] fetch error:", rpcError);
        setError(rpcError.message);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      const rows = (data ?? []) as unknown as Conversation[];
      setItems((prev) => (append ? [...prev, ...rows] : rows));
      setHasMore(rows.length === PAGE_SIZE);
      offsetRef.current = offset + rows.length;
      setLoading(false);
      setLoadingMore(false);
    },
    [enabled, accountId, tab, userId, onlyMine, unreadOnly, channelId, debouncedSearch],
  );

  // Fresh page 1 whenever the tab or any filter changes, or an
  // explicit refresh()/resyncToken bump asks for one.
  useEffect(() => {
    offsetRef.current = 0;
    fetchPage(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    accountId,
    tab,
    userId,
    onlyMine,
    unreadOnly,
    channelId,
    debouncedSearch,
    resyncToken,
    activityToken,
    reloadToken,
  ]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    fetchPage(offsetRef.current, true);
  }, [loading, loadingMore, hasMore, fetchPage]);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  return { items, loading, loadingMore, hasMore, error, loadMore, refresh };
}
