import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { handleOptOutKeywords } from "./opt-out-handler"

interface FakeDbState {
  flowRunRow: { id: string } | null
  flowRunError: { message: string } | null
  account: { broadcast_optout_keywords: string[]; broadcast_optout_enforced: boolean } | null
  inserts: { table: string; payload: unknown }[]
  updates: { table: string; payload: unknown; filters: [string, unknown][] }[]
}

function fakeDb(state: FakeDbState): SupabaseClient {
  function builder(table: string, type: "select" | "insert" | "update") {
    const filters: [string, unknown][] = []
    let payload: unknown

    const resolve = () => {
      if (table === "flow_runs") {
        return { data: state.flowRunRow, error: state.flowRunError }
      }
      if (table === "accounts") {
        return { data: state.account, error: null }
      }
      if (table === "blocked_phones") {
        if (type === "insert") {
          state.inserts.push({ table, payload })
          return { data: null, error: null }
        }
        if (type === "update") {
          state.updates.push({ table, payload, filters })
          return { data: null, error: null }
        }
      }
      return { data: null, error: null }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      insert: (p: unknown) => {
        payload = p
        return b
      },
      update: (p: unknown) => {
        payload = p
        return b
      },
      eq: (k: string, v: unknown) => {
        filters.push([k, v])
        return b
      },
      in: (k: string, v: unknown) => {
        filters.push([k, v])
        return b
      },
      is: (k: string, v: unknown) => {
        filters.push([k, v])
        return b
      },
      limit: () => b,
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    }
    return b
  }

  return {
    from: (table: string) => ({
      select: () => builder(table, "select"),
      insert: (p: unknown) => builder(table, "insert").insert(p),
      update: (p: unknown) => builder(table, "update").update(p),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function newState(overrides: Partial<FakeDbState> = {}): FakeDbState {
  return {
    flowRunRow: null,
    flowRunError: null,
    account: { broadcast_optout_keywords: ["sair", "parar", "stop", "cancelar"], broadcast_optout_enforced: false },
    inserts: [],
    updates: [],
    ...overrides,
  }
}

const baseArgs = { accountId: "acc1", contactId: "contact1", senderPhone: "+55 11 99999-0000" }

describe("handleOptOutKeywords", () => {
  it("blocks on exact keyword match and sends NO reply when enforced=false (silent capture)", async () => {
    const state = newState()
    const sendReply = vi.fn(async () => {})
    await handleOptOutKeywords(fakeDb(state), { ...baseArgs, text: "SAIR" }, sendReply)

    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({ table: "blocked_phones" })
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("blocks AND sends the confirmation reply when enforced=true", async () => {
    const state = newState({ account: { broadcast_optout_keywords: ["sair"], broadcast_optout_enforced: true } })
    const sendReply = vi.fn(async () => {})
    await handleOptOutKeywords(fakeDb(state), { ...baseArgs, text: "sair" }, sendReply)

    expect(state.inserts).toHaveLength(1)
    expect(sendReply).toHaveBeenCalledTimes(1)
  })

  it("does NOT block on a message that merely contains the keyword", async () => {
    const state = newState()
    const sendReply = vi.fn(async () => {})
    await handleOptOutKeywords(fakeDb(state), { ...baseArgs, text: "consigo sair do banco?" }, sendReply)

    expect(state.inserts).toHaveLength(0)
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("unblocks on VOLTAR and sends the reactivation reply only when enforced=true", async () => {
    const state = newState({ account: { broadcast_optout_keywords: ["sair"], broadcast_optout_enforced: true } })
    const sendReply = vi.fn(async () => {})
    await handleOptOutKeywords(fakeDb(state), { ...baseArgs, text: "voltar" }, sendReply)

    expect(state.updates).toHaveLength(1)
    expect(state.updates[0]).toMatchObject({ table: "blocked_phones" })
    expect(sendReply).toHaveBeenCalledTimes(1)
  })

  it("skips opt-out entirely when the conversation has an active flow waiting for a reply", async () => {
    const state = newState({
      account: { broadcast_optout_keywords: ["sair"], broadcast_optout_enforced: true },
      flowRunRow: { id: "run1" },
    })
    const sendReply = vi.fn(async () => {})
    await handleOptOutKeywords(fakeDb(state), { ...baseArgs, text: "sair" }, sendReply)

    expect(state.inserts).toHaveLength(0)
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("fails closed (skips opt-out) when the flow_runs check itself errors", async () => {
    const state = newState({ flowRunError: { message: "boom" } })
    const sendReply = vi.fn(async () => {})
    await handleOptOutKeywords(fakeDb(state), { ...baseArgs, text: "sair" }, sendReply)

    expect(state.inserts).toHaveLength(0)
    expect(sendReply).not.toHaveBeenCalled()
  })
})
