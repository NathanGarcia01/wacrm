const PAGE_SIZE = 1000

/**
 * Repeats a `.range()`-scoped query until a page comes back shorter
 * than PAGE_SIZE, concatenating every page. Without this, a plain
 * `.from(...).select(...)` fetch silently stops at PostgREST's
 * implicit row cap (1000) on any account/period with more rows than
 * that — the exact bug fixed once already for the Pipeline tab via a
 * server-side RPC (migration 083) but left unfixed here, where the
 * query is simple enough to just paginate client-side instead.
 */
export async function fetchAllRows<T>(
  queryFactory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await queryFactory(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}
