import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isMarketingTemplateSendBlocked } from "./marketing-template-guard"

interface FakeState {
  template: { category: string } | null
  account: { broadcast_optout_enforced: boolean } | null
  contact: { phone: string } | null
  blockedPhoneRow: { id: string } | null
}

function fakeDb(state: FakeState): SupabaseClient {
  function builder(table: string) {
    const filters: [string, unknown][] = []
    const resolve = () => {
      if (table === "message_templates") return { data: state.template, error: null }
      if (table === "accounts") return { data: state.account, error: null }
      if (table === "contacts") return { data: state.contact, error: null }
      if (table === "blocked_phones") return { data: state.blockedPhoneRow, error: null }
      return { data: null, error: null }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filters.push([k, v])
        return b
      },
      is: (k: string, v: unknown) => {
        filters.push([k, v])
        return b
      },
      limit: () => b,
      maybeSingle: () => Promise.resolve(resolve()),
    }
    return b
  }

  return {
    from: (table: string) => builder(table),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const baseArgs = { accountId: "acc1", contactId: "contact1", templateName: "promo_outubro" }

describe("isMarketingTemplateSendBlocked", () => {
  it("blocks a Marketing template when enforced and the phone is blocked", async () => {
    const state: FakeState = {
      template: { category: "Marketing" },
      account: { broadcast_optout_enforced: true },
      contact: { phone: "+5511999990000" },
      blockedPhoneRow: { id: "b1" },
    }
    expect(await isMarketingTemplateSendBlocked(fakeDb(state), baseArgs)).toBe(true)
  })

  it("does not block a Marketing template when the phone is not blocked", async () => {
    const state: FakeState = {
      template: { category: "Marketing" },
      account: { broadcast_optout_enforced: true },
      contact: { phone: "+5511999990000" },
      blockedPhoneRow: null,
    }
    expect(await isMarketingTemplateSendBlocked(fakeDb(state), baseArgs)).toBe(false)
  })

  it("never blocks when enforcement is off, even if the phone is blocked", async () => {
    const state: FakeState = {
      template: { category: "Marketing" },
      account: { broadcast_optout_enforced: false },
      contact: { phone: "+5511999990000" },
      blockedPhoneRow: { id: "b1" },
    }
    expect(await isMarketingTemplateSendBlocked(fakeDb(state), baseArgs)).toBe(false)
  })

  it("never blocks a Utility template, even if the phone is blocked and enforced", async () => {
    const state: FakeState = {
      template: { category: "Utility" },
      account: { broadcast_optout_enforced: true },
      contact: { phone: "+5511999990000" },
      blockedPhoneRow: { id: "b1" },
    }
    expect(await isMarketingTemplateSendBlocked(fakeDb(state), baseArgs)).toBe(false)
  })

  it("never blocks an Authentication template", async () => {
    const state: FakeState = {
      template: { category: "Authentication" },
      account: { broadcast_optout_enforced: true },
      contact: { phone: "+5511999990000" },
      blockedPhoneRow: { id: "b1" },
    }
    expect(await isMarketingTemplateSendBlocked(fakeDb(state), baseArgs)).toBe(false)
  })

  it("fails open (does not block) when the template can't be found", async () => {
    const state: FakeState = {
      template: null,
      account: { broadcast_optout_enforced: true },
      contact: { phone: "+5511999990000" },
      blockedPhoneRow: { id: "b1" },
    }
    expect(await isMarketingTemplateSendBlocked(fakeDb(state), baseArgs)).toBe(false)
  })
})
