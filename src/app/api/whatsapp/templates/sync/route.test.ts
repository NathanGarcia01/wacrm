import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Proves two things about migration 105's rewrite, without ever hitting
// the real Meta API or sending a WhatsApp message: (1) sync now loops
// over EVERY active Cloud API channel's WABA, not just the default
// one, and (2) a previously-synced template that stops showing up in
// ANY of them gets flagged `orphaned`, never deleted — while a
// locally-created template (no meta_template_id yet) is never touched.

interface FakeRow {
  id: string;
  [key: string]: unknown;
}

function makeFakeSupabase(state: { whatsapp_channels: FakeRow[]; message_templates: FakeRow[] }) {
  function builder(table: "whatsapp_channels" | "message_templates") {
    let mode: "select" | "update" | "insert" = "select";
    let payload: Record<string, unknown> = {};
    const filters: { col: string; op: string; val: unknown }[] = [];
    let singleMode: "maybeSingle" | null = null;

    function matches(row: FakeRow): boolean {
      return filters.every(({ col, op, val }) => {
        const v = row[col];
        if (op === "eq") return v === val;
        if (op === "not.is") return val === null ? v !== null && v !== undefined : v === null;
        if (op === "not.in") {
          const ids = String(val).slice(1, -1).split(",").filter(Boolean);
          return !ids.includes(String(v));
        }
        return true;
      });
    }

    function execute(): { data: unknown; error: null } {
      const rows = state[table];
      if (mode === "select") {
        const matched = rows.filter(matches);
        return { data: singleMode === "maybeSingle" ? (matched[0] ?? null) : matched, error: null };
      }
      if (mode === "update") {
        const matched = rows.filter(matches);
        for (const r of matched) Object.assign(r, payload);
        return { data: matched, error: null };
      }
      // insert
      const newRow: FakeRow = { id: `generated-${rows.length + 1}`, ...payload };
      rows.push(newRow);
      return { data: [newRow], error: null };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      select: () => self,
      eq: (col: string, val: unknown) => {
        filters.push({ col, op: "eq", val });
        return self;
      },
      not: (col: string, op: string, val: unknown) => {
        filters.push({ col, op: `not.${op}`, val });
        return self;
      },
      order: () => self,
      update: (p: Record<string, unknown>) => {
        mode = "update";
        payload = p;
        return self;
      },
      insert: (p: Record<string, unknown>) => {
        mode = "insert";
        payload = p;
        return self;
      },
      maybeSingle: () => {
        singleMode = "maybeSingle";
        return self;
      },
      then: (resolve: (v: unknown) => void) => resolve(execute()),
    };
    return self;
  }

  return { from: (table: "whatsapp_channels" | "message_templates") => builder(table) };
}

vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: (v: string) => v, // identity — fake tokens never touch real crypto
}));

describe("POST /api/whatsapp/templates/sync — multi-WABA + orphan marking", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      const data = url.includes("/waba-1/")
        ? [{ id: "meta-1", name: "hello", language: "pt_BR", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Olá" }] }]
        : url.includes("/waba-2/")
          ? [{ id: "meta-2", name: "bye", language: "pt_BR", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Tchau" }] }]
          : [];
      return {
        ok: true,
        json: async () => ({ data, paging: {} }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("syncs templates from every active WABA and orphans a stale one, leaving a local draft alone", async () => {
    const state: { whatsapp_channels: FakeRow[]; message_templates: FakeRow[] } = {
      whatsapp_channels: [
        { id: "ch-1", account_id: "account-1", waba_id: "waba-1", access_token_encrypted: "tok-1", is_active: true, channel_type: "cloud_api" },
        { id: "ch-2", account_id: "account-1", waba_id: "waba-2", access_token_encrypted: "tok-2", is_active: true, channel_type: "cloud_api" },
        // Inactive — must never be queried.
        { id: "ch-3", account_id: "account-1", waba_id: "waba-3", access_token_encrypted: "tok-3", is_active: false, channel_type: "cloud_api" },
      ],
      message_templates: [
        // Belonged to a WABA that's no longer connected — must flip to orphaned.
        { id: "row-stale", account_id: "account-1", name: "old_promo", language: "pt_BR", meta_template_id: "meta-OLD", orphaned: false },
        // Never submitted to Meta — must never be touched by orphan marking.
        { id: "row-local", account_id: "account-1", name: "draft_only", language: "pt_BR", meta_template_id: null, orphaned: false },
      ],
    };

    const fakeSupabase = makeFakeSupabase(state);
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        ...fakeSupabase,
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
      }),
    }));
    // profiles lookup piggybacks on the same fake — add it to state's shape dynamically.
    const originalFrom = fakeSupabase.from;
    fakeSupabase.from = ((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { account_id: "account-1" }, error: null }),
            }),
          }),
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalFrom(table as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    const { POST } = await import("./route");
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.wabasSynced).toBe(2);
    expect(body.wabasTotal).toBe(2); // waba-3 excluded — its channel is inactive
    expect(body.inserted).toBe(2);
    expect(body.orphaned).toBe(1);
    expect(body.errors).toEqual([]);

    // Fetched from both connected WABAs, never the inactive one.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calledUrls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(calledUrls.some((u) => u.includes("/waba-1/"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/waba-2/"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/waba-3/"))).toBe(false);

    const inserted1 = state.message_templates.find((r) => r.meta_template_id === "meta-1");
    const inserted2 = state.message_templates.find((r) => r.meta_template_id === "meta-2");
    expect(inserted1?.waba_id).toBe("waba-1");
    expect(inserted2?.waba_id).toBe("waba-2");

    const stale = state.message_templates.find((r) => r.id === "row-stale");
    expect(stale?.orphaned).toBe(true);

    const local = state.message_templates.find((r) => r.id === "row-local");
    expect(local?.orphaned).toBe(false);
  });
});
