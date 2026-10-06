"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TicketTabCounts } from "@/components/inbox/ticket-status-tabs";

const EMPTY_COUNTS: TicketTabCounts = { pending: 0, in_progress: 0, closed: 0, no_ticket: 0 };

/**
 * Fase 1 (atendimento) — tab badge counts via `get_inbox_tab_counts`
 * (migration 075), a `count(*)` in the database. Replaces tallying
 * the in-memory `conversations` array, which silently capped at
 * PostgREST's default 1000-row fetch limit (the "Sem atendimento"
 * counter stuck at 1000 this was reported against).
 */
export function useInboxTabCounts({
  enabled,
  accountId,
  userId,
  onlyMine,
  unreadOnly,
  resyncToken = 0,
  activityToken = 0,
}: {
  enabled: boolean;
  accountId: string | null;
  userId?: string | null;
  onlyMine: boolean;
  unreadOnly: boolean;
  resyncToken?: number;
  /** Bumped (debounced) by the page on every realtime message/
   *  conversation/ticket event — see usePaginatedInboxList's doc
   *  comment for why this is what makes the badges update without a
   *  manual reload. */
  activityToken?: number;
}): { counts: TicketTabCounts; refresh: () => void } {
  const [counts, setCounts] = useState<TicketTabCounts>(EMPTY_COUNTS);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled || !accountId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .rpc("get_inbox_tab_counts", {
        p_account_id: accountId,
        p_user_id: userId ?? null,
        p_only_mine: onlyMine,
        p_unread_only: unreadOnly,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[useInboxTabCounts] fetch error:", error);
          return;
        }
        setCounts((data as TicketTabCounts | null) ?? EMPTY_COUNTS);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, accountId, userId, onlyMine, unreadOnly, resyncToken, activityToken, reloadToken]);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  return { counts, refresh };
}
