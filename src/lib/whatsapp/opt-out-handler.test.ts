import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { handleOptOutButtonTap, handleOptOutKeywords } from "./opt-out-handler"

interface FakeDbState {
  flowRunRow: { id: string } | null
  flowRunError: { message: string } | null
  account: { broadcast_optout_keywords: string[]; broadcast_optout_enforced: boolean } | null
  inserts: { table: string; payload: unknown }[]
  updates: { table: string; payload: unknown; filters: [string, unknown][] }[]
  /** Phones with an active (unblocked_at IS NULL) block — mirrors the
   *  partial unique index (migration 091) so a repeat insert for the
   *  same phone fails with 23505 the same way Postgres would, letting
   *  tests verify blockPhone's real idempotency rather than just
   *  trusting the mock to always say "ok". */
  blockedActive: Set<string>
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
          const phone = (payload as { phone?: string })?.phone ?? ""
          if (state.blockedActive.has(phone)) {
            return { data: null, error: { code: "23505", message: "duplicate key value" } }
          }
          state.blockedActive.add(phone)
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
    blockedActive: new Set(),
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

describe("handleOptOutButtonTap", () => {
  it("blocks on the SAIR button, same keyword list as free text, silent when enforced=false", async () => {
    const state = newState()
    const sendReply = vi.fn(async () => {})
    await handleOptOutButtonTap(
      fakeDb(state),
      { ...baseArgs, buttonText: "SAIR", buttonPayload: "SAIR" },
      sendReply,
    )

    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({
      table: "blocked_phones",
      payload: expect.objectContaining({ reason: "button:sair" }),
    })
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("blocks on the SAIR button AND sends the confirmation reply when enforced=true", async () => {
    const state = newState({ account: { broadcast_optout_keywords: ["sair"], broadcast_optout_enforced: true } })
    const sendReply = vi.fn(async () => {})
    await handleOptOutButtonTap(
      fakeDb(state),
      { ...baseArgs, buttonText: "SAIR", buttonPayload: "SAIR" },
      sendReply,
    )

    expect(state.inserts).toHaveLength(1)
    expect(sendReply).toHaveBeenCalledTimes(1)
  })

  it("blocks unconditionally on NÃO SOU A PESSOA, even with enforced=false and no matching keyword", async () => {
    const state = newState({
      account: { broadcast_optout_keywords: ["sair"], broadcast_optout_enforced: false },
    })
    const sendReply = vi.fn(async () => {})
    await handleOptOutButtonTap(
      fakeDb(state),
      { ...baseArgs, buttonText: "NÃO SOU A PESSOA", buttonPayload: "NÃO SOU A PESSOA" },
      sendReply,
    )

    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({
      table: "blocked_phones",
      payload: expect.objectContaining({ reason: "button:nao sou a pessoa" }),
    })
  })

  it("matches regardless of accent/case variation in the button label", async () => {
    const state = newState()
    const sendReply = vi.fn(async () => {})
    // Lowercase, no accent, extra padding — same normalizeOptOutText
    // rule as every other opt-out check in this module.
    await handleOptOutButtonTap(
      fakeDb(state),
      { ...baseArgs, buttonText: "  nao sou a pessoa  ", buttonPayload: "" },
      sendReply,
    )

    expect(state.inserts).toHaveLength(1)
  })

  it("is idempotent across repeated taps on the same button", async () => {
    const state = newState({ account: { broadcast_optout_keywords: ["sair"], broadcast_optout_enforced: true } })
    const sendReply = vi.fn(async () => {})
    const tap = () =>
      handleOptOutButtonTap(fakeDb(state), { ...baseArgs, buttonText: "SAIR", buttonPayload: "SAIR" }, sendReply)

    await tap()
    await expect(tap()).resolves.not.toThrow()

    // Only the first tap actually inserted a row — the second hit the
    // partial unique index (simulated 23505) and blockPhone swallowed
    // it, same as the real migration-091 constraint would.
    expect(state.inserts).toHaveLength(1)
  })

  it("does not block on a button that isn't an opt-out signal", async () => {
    const state = newState()
    const sendReply = vi.fn(async () => {})
    await handleOptOutButtonTap(
      fakeDb(state),
      { ...baseArgs, buttonText: "VER ATUALIZAÇÃO", buttonPayload: "VER ATUALIZAÇÃO" },
      sendReply,
    )

    expect(state.inserts).toHaveLength(0)
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("checks the payload too when it differs from the display text", async () => {
    const state = newState()
    const sendReply = vi.fn(async () => {})
    await handleOptOutButtonTap(
      fakeDb(state),
      { ...baseArgs, buttonText: "Sair da lista", buttonPayload: "sair" },
      sendReply,
    )

    expect(state.inserts).toHaveLength(1)
  })
})
