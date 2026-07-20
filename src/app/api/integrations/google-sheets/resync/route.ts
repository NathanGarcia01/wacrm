import { NextResponse } from 'next/server'
import { getAuthedAccount } from '@/lib/integrations/require-account'
import { fullResync } from '@/lib/integrations/google-sheets'

/**
 * POST /api/integrations/google-sheets/resync
 *
 * "Sincronizar agora": wipes and repopulates every tab from the
 * account's current pipeline stages and deals. Synchronous — the UI
 * shows a spinner and awaits the response rather than polling a job.
 */
export async function POST() {
  const account = await getAuthedAccount()
  if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!account.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const result = await fullResync(account.accountId)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[google-sheets/resync] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
