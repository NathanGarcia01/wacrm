import { NextResponse } from 'next/server'
import { syncDealToSheet, removeDealFromSheet } from '@/lib/integrations/google-sheets'

/**
 * POST /api/integrations/google-sheets/sync
 *
 * Called by the `deals_google_sheets_sync` DB trigger (see migration
 * 038) via pg_net whenever a deal is inserted, updated, or deleted —
 * not by the client. Auth is a shared secret in `x-cron-secret`
 * (stored in Supabase Vault, mirrored here as GOOGLE_SHEETS_SYNC_SECRET),
 * same pattern as the other api/.../cron routes' AUTOMATION_CRON_SECRET.
 */
export async function POST(request: Request) {
  const expected = process.env.GOOGLE_SHEETS_SYNC_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'sync not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { deal_id, account_id, op } = body as {
    deal_id?: string
    account_id?: string
    op?: string
  }
  if (!deal_id || !account_id || !op) {
    return NextResponse.json({ error: 'deal_id, account_id and op are required' }, { status: 400 })
  }

  try {
    if (op === 'DELETE') {
      await removeDealFromSheet(account_id, deal_id)
    } else {
      await syncDealToSheet(account_id, deal_id)
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    // Best-effort: pg_net doesn't retry non-2xx responses and there's
    // no caller waiting on this fire-and-forget call, so log and move on.
    console.error('[google-sheets/sync] failed:', err)
    return NextResponse.json({ error: 'sync failed' }, { status: 500 })
  }
}
