import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isWithinAccountBusinessHours, isWithinBusinessHoursWindow } from './business-hours'

describe('isWithinBusinessHoursWindow', () => {
  const windows = [{ start_time: '08:00:00', end_time: '12:00:00' }, { start_time: '13:00:00', end_time: '18:00:00' }]

  it('is within a window', () => {
    expect(isWithinBusinessHoursWindow(windows, { weekday: 1, time: '09:30:00' })).toBe(true)
    expect(isWithinBusinessHoursWindow(windows, { weekday: 1, time: '14:00:00' })).toBe(true)
  })

  it('is outside every window (lunch break, before/after hours)', () => {
    expect(isWithinBusinessHoursWindow(windows, { weekday: 1, time: '12:30:00' })).toBe(false)
    expect(isWithinBusinessHoursWindow(windows, { weekday: 1, time: '07:00:00' })).toBe(false)
    expect(isWithinBusinessHoursWindow(windows, { weekday: 1, time: '23:00:00' })).toBe(false)
  })

  it('start is inclusive, end is exclusive', () => {
    expect(isWithinBusinessHoursWindow(windows, { weekday: 1, time: '08:00:00' })).toBe(true)
    expect(isWithinBusinessHoursWindow(windows, { weekday: 1, time: '12:00:00' })).toBe(false)
  })

  it('no windows at all (e.g. weekend with nothing configured) is always outside', () => {
    expect(isWithinBusinessHoursWindow([], { weekday: 0, time: '10:00:00' })).toBe(false)
  })
})

function fakeDb(opts: {
  timezone?: string | null
  holiday?: boolean
  windows?: { start_time: string; end_time: string }[]
}): SupabaseClient {
  function builder(table: string) {
    const filters: [string, unknown][] = []
    const resolve = () => {
      if (table === 'accounts') return { data: { timezone: opts.timezone ?? 'America/Sao_Paulo' }, error: null }
      if (table === 'holidays') return { data: opts.holiday ? { id: 'h1' } : null, error: null }
      if (table === 'business_hours') return { data: opts.windows ?? [], error: null }
      return { data: null, error: null }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push([k, v]), b),
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(onF, onR),
    }
    return b
  }
  return { from: (t: string) => builder(t) } as unknown as SupabaseClient
}

describe('isWithinAccountBusinessHours', () => {
  it('is false on a holiday even during a configured window', async () => {
    // 2026-11-18 12:00 UTC is safely midday in America/Sao_Paulo on a Wednesday.
    const now = new Date('2026-11-18T12:00:00.000Z')
    const db = fakeDb({ holiday: true, windows: [{ start_time: '00:00:00', end_time: '23:59:59' }] })
    expect(await isWithinAccountBusinessHours(db, 'acc1', now)).toBe(false)
  })

  it('is false with no business_hours rows configured for that weekday', async () => {
    const now = new Date('2026-11-18T12:00:00.000Z')
    const db = fakeDb({ windows: [] })
    expect(await isWithinAccountBusinessHours(db, 'acc1', now)).toBe(false)
  })

  it('is true when now falls inside a configured window in the account timezone', async () => {
    // 2026-11-18T12:00:00Z = 09:00 in America/Sao_Paulo (UTC-3).
    const now = new Date('2026-11-18T12:00:00.000Z')
    const db = fakeDb({ timezone: 'America/Sao_Paulo', windows: [{ start_time: '08:00:00', end_time: '18:00:00' }] })
    expect(await isWithinAccountBusinessHours(db, 'acc1', now)).toBe(true)
  })

  it('respects a different account timezone', async () => {
    // Same instant, but for a UTC+0 account 12:00Z is also 12:00 local —
    // outside an 08:00-11:00 window.
    const now = new Date('2026-11-18T12:00:00.000Z')
    const db = fakeDb({ timezone: 'UTC', windows: [{ start_time: '08:00:00', end_time: '11:00:00' }] })
    expect(await isWithinAccountBusinessHours(db, 'acc1', now)).toBe(false)
  })
})
