import { createClient } from "@/lib/supabase/client";
import type { TicketTab } from "@/components/inbox/ticket-status-tabs";

export interface TabFilterParams {
  accountId: string;
  tab: TicketTab;
  userId?: string | null;
  onlyMine: boolean;
  unreadOnly: boolean;
  channelId?: string | null;
  search?: string;
}

const PAGE_SIZE = 200;

/**
 * Fase 1 (atendimento) — resolves "selecionar todos os N" (every
 * conversation matching the active tab/filters, not just what's
 * loaded on screen) into a concrete id list, server-side, via
 * `list_inbox_tab_conversations`.
 *
 * Resolves the FULL list upfront, before any bulk action runs —
 * deliberately not interleaved with dispatching the action. Most
 * ticket actions (assign/transfer/return/close) remove the
 * conversation from whichever tab is currently selected (closing a
 * pending ticket takes it out of "Pendentes"), so if resolution and
 * action ran interleaved, paging by `offset` over a shrinking result
 * set would skip rows. Resolving fully first, THEN dispatching the
 * action over that frozen list (see runBulkAction's batching),
 * sidesteps that entirely.
 */
export async function resolveAllTabConversationIds(params: TabFilterParams): Promise<string[]> {
  const supabase = createClient();
  const allIds: string[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase.rpc("list_inbox_tab_conversations", {
      p_account_id: params.accountId,
      p_tab: params.tab,
      p_user_id: params.userId ?? null,
      p_only_mine: params.onlyMine,
      p_unread_only: params.unreadOnly,
      p_channel_id: params.channelId ?? null,
      p_search: params.search || null,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (error) throw error;
    const rows = (data ?? []) as { id: string }[];
    if (rows.length === 0) break;
    allIds.push(...rows.map((r) => r.id));
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allIds;
}
