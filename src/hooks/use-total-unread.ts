"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Conversation } from "@/types";

/** Just the fields this hook's local mirror needs to track per conversation. */
interface UnreadTrackedFields {
  status: Conversation["status"];
  unread_count: number;
}

/**
 * Count of OPEN conversations with at least one unread inbound message
 * for the current user — closed/pending conversations don't compete for
 * attention here. Used by the sidebar to surface a badge on the Inbox
 * nav entry when the user is elsewhere in the app.
 *
 * Lives on its own realtime channel (distinct from the inbox page's
 * "inbox-realtime") so both can coexist without sharing state.
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);

  // Keep a live local mirror of {id: {status, unread_count}} so
  // INSERT/UPDATE/DELETE events can adjust the total in O(1) without
  // refetching.
  const rowsRef = useRef<Map<string, UnreadTrackedFields>>(new Map());

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // Initial load. RLS scopes this to the signed-in user automatically —
    // no explicit user_id filter needed here.
    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, status, unread_count");
      if (cancelled || error || !data) return;

      const map = new Map<string, UnreadTrackedFields>();
      let sum = 0;
      for (const row of data as (UnreadTrackedFields & { id: string })[]) {
        const n = row.unread_count ?? 0;
        map.set(row.id, { status: row.status, unread_count: n });
        if (row.status === "open" && n > 0) sum += 1;
      }
      rowsRef.current = map;
      setTotal(sum);
    })();

    const channel = supabase
      .channel("total-unread-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const map = rowsRef.current;
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Conversation>;
            if (oldRow.id) map.delete(oldRow.id);
          } else {
            const row = payload.new as Conversation;
            map.set(row.id, {
              status: row.status,
              unread_count: row.unread_count ?? 0,
            });
          }
          // Recompute — cheap, conversations per user stay small.
          let sum = 0;
          for (const r of map.values()) {
            if (r.status === "open" && r.unread_count > 0) sum += 1;
          }
          setTotal(sum);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return total;
}
