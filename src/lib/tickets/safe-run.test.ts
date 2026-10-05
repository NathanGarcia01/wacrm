import { afterEach, describe, expect, it, vi } from 'vitest'
import { runTicketSideEffect } from './safe-run'

describe('runTicketSideEffect', () => {
  afterEach(() => {
    delete process.env.TICKETS_ENABLED
    vi.restoreAllMocks()
  })

  it('does nothing when TICKETS_ENABLED is unset (default off)', async () => {
    const fn = vi.fn(async () => {})
    await runTicketSideEffect('test', fn)
    expect(fn).not.toHaveBeenCalled()
  })

  it('does nothing when TICKETS_ENABLED is any value other than "true"', async () => {
    process.env.TICKETS_ENABLED = 'false'
    const fn = vi.fn(async () => {})
    await runTicketSideEffect('test', fn)
    expect(fn).not.toHaveBeenCalled()
  })

  it('runs the side effect when TICKETS_ENABLED=true', async () => {
    process.env.TICKETS_ENABLED = 'true'
    const fn = vi.fn(async () => {})
    await runTicketSideEffect('test', fn)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('swallows an error from the side effect — never propagates', async () => {
    process.env.TICKETS_ENABLED = 'true'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fn = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(runTicketSideEffect('test', fn)).resolves.toBeUndefined()
    expect(fn).toHaveBeenCalledOnce()
    expect(console.error).toHaveBeenCalledWith('[tickets] test failed:', expect.any(Error))
  })
})
