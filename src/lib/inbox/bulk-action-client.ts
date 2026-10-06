/**
 * Fase 1 (atendimento) — client-side batching for
 * POST /api/tickets/bulk-action. The route caps a single request at
 * 200 conversation ids; "selecionar todos os N" can mean thousands,
 * so this chunks the id list and dispatches sequentially, reporting
 * progress after each batch — never a single request with thousands
 * of ids, per the approved plan.
 */

export type BulkAction = "mark_read" | "mark_unread" | "assign" | "transfer" | "return_to_queue" | "close";

export const BULK_ACTION_BATCH_SIZE = 200;

export interface BulkActionResultRow {
  conversationId: string;
  status: "success" | "skipped" | "failed";
  reason?: string;
}

export interface BulkActionSummary {
  total: number;
  succeeded: BulkActionResultRow[];
  skipped: BulkActionResultRow[];
  failed: BulkActionResultRow[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function postBatch(
  action: BulkAction,
  conversationIds: string[],
  payload: Record<string, unknown> | undefined,
): Promise<BulkActionResultRow[]> {
  const res = await fetch("/api/tickets/bulk-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, conversationIds, payload }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // The whole batch failed before per-conversation processing even
    // started (bad action, invalid closing reason, etc.) — surface it
    // as every id in this batch failing, so the summary is honest
    // about what didn't happen instead of silently dropping it.
    const reason = body?.error ?? `HTTP ${res.status}`;
    return conversationIds.map((conversationId) => ({
      conversationId,
      status: "failed" as const,
      reason,
    }));
  }
  const { results } = await res.json();
  return results as BulkActionResultRow[];
}

/**
 * Runs a bulk action over `conversationIds`, in batches of
 * `BULK_ACTION_BATCH_SIZE`, calling `onProgress` after each batch so
 * the UI can show a progress bar across potentially many requests.
 */
export async function runBulkAction(
  action: BulkAction,
  conversationIds: string[],
  payload: Record<string, unknown> | undefined,
  onProgress?: (processed: number, total: number) => void,
): Promise<BulkActionSummary> {
  const batches = chunk(conversationIds, BULK_ACTION_BATCH_SIZE);
  const all: BulkActionResultRow[] = [];

  for (const batch of batches) {
    const rows = await postBatch(action, batch, payload);
    all.push(...rows);
    onProgress?.(all.length, conversationIds.length);
  }

  return {
    total: conversationIds.length,
    succeeded: all.filter((r) => r.status === "success"),
    skipped: all.filter((r) => r.status === "skipped"),
    failed: all.filter((r) => r.status === "failed"),
  };
}
