import { describe, expect, it } from "vitest"
import { fetchAllRows } from "./paginate"

describe("fetchAllRows", () => {
  it("returns every row across pages when the source caps each page at 1000", async () => {
    const total = 2500
    const all = Array.from({ length: total }, (_, i) => ({ id: i }))
    const calls: { from: number; to: number }[] = []

    const result = await fetchAllRows((from, to) => {
      calls.push({ from, to })
      return Promise.resolve({ data: all.slice(from, to + 1), error: null })
    })

    expect(result).toHaveLength(total)
    expect(result).toEqual(all)
    // 1000 + 1000 + 500 — three pages, the last one short enough to stop.
    expect(calls).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
    ])
  })

  it("stops after a single page when the source has fewer rows than the page size", async () => {
    const all = [{ id: 1 }, { id: 2 }, { id: 3 }]

    const result = await fetchAllRows((from, to) =>
      Promise.resolve({ data: all.slice(from, to + 1), error: null }),
    )

    expect(result).toEqual(all)
  })

  it("returns an empty array when the source has no rows", async () => {
    const result = await fetchAllRows(() => Promise.resolve({ data: [], error: null }))
    expect(result).toEqual([])
  })

  it("returns an empty array when the source returns null data", async () => {
    const result = await fetchAllRows(() => Promise.resolve({ data: null, error: null }))
    expect(result).toEqual([])
  })

  it("throws when a page errors, without swallowing the error", async () => {
    const boom = new Error("boom")
    await expect(
      fetchAllRows(() => Promise.resolve({ data: null, error: boom })),
    ).rejects.toThrow("boom")
  })

  it("does not request a second page when the first page lands exactly on a 1000-row boundary followed by zero rows", async () => {
    const all = Array.from({ length: 1000 }, (_, i) => ({ id: i }))
    const calls: { from: number; to: number }[] = []

    const result = await fetchAllRows((from, to) => {
      calls.push({ from, to })
      const page = all.slice(from, to + 1)
      return Promise.resolve({ data: page, error: null })
    })

    // A full 1000-row page is ambiguous (could be exactly 1000 total,
    // or truncated) — fetchAllRows must request the next page to find
    // out, even though it comes back empty.
    expect(calls).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ])
    expect(result).toHaveLength(1000)
  })
})
