import { describe, expect, it } from "vitest"
import { loadLossesReport } from "./losses-queries"

/**
 * Minimal fake Supabase query builder — just enough chain surface
 * (select/eq/gte/lt/is/order/range, `count: 'exact', head: true`,
 * and await-as-thenable) for loadLossesReport's exact query shapes.
 * `range` slices `rows` so the fake behaves like PostgREST's own
 * implicit row cap would on a real, unpaginated query — proving
 * fetchAllRows (used for the lost-deals query) actually pages through
 * all of them instead of stopping at the first slice.
 */
function fakeTable(rows: Record<string, unknown>[]) {
  let rangeFrom = 0
  let rangeTo = Infinity
  let isHeadCount = false
  const builder = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      isHeadCount = !!opts?.head
      return builder
    },
    eq: () => builder,
    gte: () => builder,
    lt: () => builder,
    is: () => builder,
    in: () => builder,
    order: () => builder,
    range(from: number, to: number) {
      rangeFrom = from
      rangeTo = to
      return builder
    },
    then(resolve: (v: { data: unknown[] | null; error: null; count?: number }) => void) {
      if (isHeadCount) {
        resolve({ data: null, error: null, count: rows.length })
      } else {
        resolve({ data: rows.slice(rangeFrom, rangeTo + 1), error: null })
      }
    },
  }
  return builder
}

function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      return fakeTable(tables[table] ?? [])
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function lostDeal(id: string, lostAt: string) {
  return {
    id,
    title: `Deal ${id}`,
    value: 100,
    currency: "BRL",
    status: "lost",
    lost_reason: "Sem interesse",
    lost_reason_id: null,
    loss_reason_catalog: null,
    lost_at: lostAt,
    won_at: null,
    created_at: lostAt,
    stage_id: "stage-1",
    conversation_id: null,
    contact: null,
    assignee: null,
  }
}

describe("loadLossesReport", () => {
  it("counts every lost deal even when there are more than 1000 (PostgREST's implicit row cap)", async () => {
    const total = 1250
    const rows = Array.from({ length: total }, (_, i) =>
      lostDeal(`deal-${i}`, new Date(2026, 0, 1 + i).toISOString()),
    )
    const db = fakeDb({ deals: rows, messages: [] })

    const result = await loadLossesReport(db, {
      pipelineId: "pipeline-1",
      period: null,
      assignedTo: "",
      stageId: "",
      tagIds: [],
      stageNameById: new Map(),
    })

    expect(result.totalLost).toBe(total)
    expect(result.deals).toHaveLength(total)
  })

  it("matches the database total exactly at the 1000-row boundary (999, 1000, 1001)", async () => {
    for (const total of [999, 1000, 1001]) {
      const rows = Array.from({ length: total }, (_, i) =>
        lostDeal(`deal-${i}`, new Date(2026, 0, 1 + i).toISOString()),
      )
      const db = fakeDb({ deals: rows, messages: [] })
      const result = await loadLossesReport(db, {
        pipelineId: "pipeline-1",
        period: null,
        assignedTo: "",
        stageId: "",
        tagIds: [],
        stageNameById: new Map(),
      })
      expect(result.totalLost).toBe(total)
    }
  })
})
