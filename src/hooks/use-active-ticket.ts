"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Ticket } from "@/types";

export interface UseActiveTicketResult {
  /** `undefined` = loading (or no conversation selected / flag off).
   *  `null` = loaded, this conversation has never had a ticket.
   *  `Ticket` = the conversation's open ticket, or its latest closed
   *  one if none is open — see the query comment below for why a
   *  single `order by opened_at desc limit 1` is enough to mean
   *  exactly that. */
  ticket: Ticket | null | undefined;
  loading: boolean;
  /** Lets the header apply the result of its own POST (assign/
   *  transfer/close/open) immediately, without waiting for the
   *  realtime round trip — same "optimistic-after-server-confirms"
   *  pattern the rest of the inbox uses. */
  setTicket: (ticket: Ticket) => void;
}

/**
 * Fase 1 (atendimento) — Etapa 6 fix: the chat header needs the
 * SELECTED conversation's ticket, fetched and kept live independently
 * of whatever `ConversationList`'s own join last happened to contain.
 * That list-level join only runs once per list fetch and has no
 * reason to re-run just because the user clicked a conversation, so
 * depending on it left the header showing stale (often `undefined`)
 * data — see the bug this hook replaces.
 *
 * `order by opened_at desc limit 1` is deliberately simpler than
 * "fetch the open one, else the latest closed one" as two queries:
 * openTicketIfNeeded never opens a second ticket while one is
 * already open (partial unique index, migration 070), so whichever
 * ticket is open is BY CONSTRUCTION also the most recent by
 * opened_at. One row, one query, always the right one.
 */
export function useActiveTicket(
  conversationId: string | null,
  enabled: boolean,
): UseActiveTicketResult {
  const [ticket, setTicketState] = useState<Ticket | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  });

  useEffect(() => {
    if (!enabled || !conversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTicketState(undefined);
      setLoading(false);
      return;
    }

    const supabase = createClient();
    let cancelled = false;
    setLoading(true);
    setTicketState(undefined);

    supabase
      .from("tickets")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[useActiveTicket] fetch error:", error);
          setTicketState(null);
        } else {
          setTicketState((data as Ticket | null) ?? null);
        }
        setLoading(false);
      });

    // Scoped (not the account-wide channel inbox/page.tsx already
    // runs for the list) so this never has to filter out noise from
    // every other conversation's tickets — RLS still applies on top
    // regardless, same as every other postgres_changes subscription
    // in this app.
    const channel = supabase
      .channel(`active-ticket-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tickets",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          if (conversationIdRef.current !== conversationId) return;
          setTicketState(payload.new as Ticket);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [conversationId, enabled]);

  return {
    ticket,
    loading,
    setTicket: (next: Ticket) => setTicketState(next),
  };
}
