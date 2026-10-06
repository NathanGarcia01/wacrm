import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runBulkAction, BULK_ACTION_BATCH_SIZE } from "./bulk-action-client";

describe("runBulkAction", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("never sends more than BULK_ACTION_BATCH_SIZE ids in a single request", async () => {
    const total = BULK_ACTION_BATCH_SIZE * 2 + 37;
    const ids = Array.from({ length: total }, (_, i) => `conv-${i}`);
    const batchSizes: number[] = [];

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      batchSizes.push(body.conversationIds.length);
      return {
        ok: true,
        json: async () => ({
          results: body.conversationIds.map((conversationId: string) => ({
            conversationId,
            status: "success",
          })),
        }),
      } as Response;
    });

    const summary = await runBulkAction("mark_read", ids, undefined);

    expect(batchSizes).toEqual([BULK_ACTION_BATCH_SIZE, BULK_ACTION_BATCH_SIZE, 37]);
    expect(batchSizes.every((n) => n <= BULK_ACTION_BATCH_SIZE)).toBe(true);
    expect(summary.total).toBe(total);
    expect(summary.succeeded).toHaveLength(total);
  });

  it("reports progress after each batch, not just at the end", async () => {
    const ids = Array.from({ length: BULK_ACTION_BATCH_SIZE + 10 }, (_, i) => `conv-${i}`);
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      return {
        ok: true,
        json: async () => ({
          results: body.conversationIds.map((conversationId: string) => ({
            conversationId,
            status: "success",
          })),
        }),
      } as Response;
    });

    const progressCalls: Array<[number, number]> = [];
    await runBulkAction("mark_read", ids, undefined, (processed, total) =>
      progressCalls.push([processed, total]),
    );

    expect(progressCalls).toEqual([
      [BULK_ACTION_BATCH_SIZE, ids.length],
      [ids.length, ids.length],
    ]);
  });

  it("buckets succeeded/skipped/failed from the route's response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { conversationId: "a", status: "success" },
          { conversationId: "b", status: "skipped", reason: "no_open_ticket" },
          { conversationId: "c", status: "failed", reason: "boom" },
        ],
      }),
    } as Response);

    const summary = await runBulkAction("close", ["a", "b", "c"], { closingReasonId: "r1" });

    expect(summary.succeeded.map((r) => r.conversationId)).toEqual(["a"]);
    expect(summary.skipped.map((r) => r.conversationId)).toEqual(["b"]);
    expect(summary.failed.map((r) => r.conversationId)).toEqual(["c"]);
  });

  it("marks every id in a batch as failed when the whole request errors out", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "System closing reasons cannot be used here" }),
    } as Response);

    const summary = await runBulkAction("close", ["a", "b"], { closingReasonId: "system-reason" });

    expect(summary.failed).toHaveLength(2);
    expect(summary.failed[0].reason).toBe("System closing reasons cannot be used here");
    expect(summary.succeeded).toHaveLength(0);
  });
});
