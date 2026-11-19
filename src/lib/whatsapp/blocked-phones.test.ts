import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { blockPhone, isPhoneBlocked } from "./blocked-phones"

interface Row {
  account_id: string
  phone: string
  phone_normalized: string
  source: string
  unblocked_at: string | null
}

/**
 * Fase 2 (Radar) — produto: these two functions are the entire
 * mechanism behind "bloqueio sempre ligado" (broadcasts/cron,
 * use-broadcast-sending, marketing-template-guard all just call
 * isPhoneBlocked unconditionally now). What makes "a contact blocked
 * AFTER it was already queued still gets skipped" true in production
 * is that isPhoneBlocked does a live read every time it's called,
 * never a cached/snapshotted one — this fake mirrors that by sharing
 * one mutable `rows` array between a blockPhone call and a LATER
 * isPhoneBlocked call on the same fakeDb instance.
 */
function fakeDb(rows: Row[]): SupabaseClient {
  function builder(type: "select" | "insert") {
    const filters: [string, unknown][] = []
    let payload: Record<string, unknown> | undefined

    const resolve = () => {
      if (type === "insert" && payload) {
        const phoneNormalized = (payload.phone as string).replace(/\D/g, "")
        const alreadyActive = rows.some(
          (r) => r.account_id === payload!.account_id && r.phone_normalized === phoneNormalized && r.unblocked_at === null,
        )
        if (alreadyActive) {
          return { data: null, error: { code: "23505", message: "duplicate key value" } }
        }
        rows.push({
          account_id: payload.account_id as string,
          phone: payload.phone as string,
          phone_normalized: phoneNormalized,
          source: payload.source as string,
          unblocked_at: null,
        })
        return { data: null, error: null }
      }

      // select
      const accountId = filters.find((f) => f[0] === "account_id")?.[1]
      const phoneNormalized = filters.find((f) => f[0] === "phone_normalized")?.[1]
      const row = rows.find(
        (r) => r.account_id === accountId && r.phone_normalized === phoneNormalized && r.unblocked_at === null,
      )
      return { data: row ? { id: `${row.account_id}:${row.phone_normalized}` } : null, error: null }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      insert: (p: Record<string, unknown>) => {
        payload = p
        return b
      },
      eq: (k: string, v: unknown) => {
        filters.push([k, v])
        return b
      },
      is: () => b,
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    }
    return b
  }

  return {
    from: () => ({
      select: () => builder("select"),
      insert: (p: Record<string, unknown>) => builder("insert").insert(p),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe("isPhoneBlocked", () => {
  it("returns false for a phone that was never blocked", async () => {
    const db = fakeDb([])
    expect(await isPhoneBlocked(db, "acc1", "+5511999990000")).toBe(false)
  })

  it("returns true once blockPhone has run — a contact blocked AFTER being queued is still caught", async () => {
    // Same fakeDb instance (same `rows` array) used for both calls,
    // mirroring how the real cron calls isPhoneBlocked fresh at send
    // time, not from a snapshot taken when the recipient was queued.
    const rows: Row[] = []
    const db = fakeDb(rows)

    expect(await isPhoneBlocked(db, "acc1", "+5511999990000")).toBe(false)

    await blockPhone(db, "acc1", "+5511999990000", "keyword", "keyword:sair")

    expect(await isPhoneBlocked(db, "acc1", "+5511999990000")).toBe(true)
  })

  it("is scoped per account — blocking on one account never affects another", async () => {
    const rows: Row[] = []
    const db = fakeDb(rows)
    await blockPhone(db, "acc1", "+5511999990000", "keyword", "keyword:sair")

    expect(await isPhoneBlocked(db, "acc1", "+5511999990000")).toBe(true)
    expect(await isPhoneBlocked(db, "acc2", "+5511999990000")).toBe(false)
  })
})

describe("blockPhone", () => {
  it("is idempotent — blocking the same phone twice does not throw", async () => {
    const rows: Row[] = []
    const db = fakeDb(rows)
    await blockPhone(db, "acc1", "+5511999990000", "keyword", "keyword:sair")
    await expect(blockPhone(db, "acc1", "+5511999990000", "keyword", "keyword:sair")).resolves.not.toThrow()
    expect(rows).toHaveLength(1)
  })
})
