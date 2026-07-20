import { NextResponse } from 'next/server'
import { getAuthedAccount } from '@/lib/integrations/require-account'
import { buildGoogleAuthUrl } from '@/lib/integrations/google-oauth'

/**
 * GET /api/integrations/google-sheets/connect
 *
 * Redirects to Google's OAuth consent screen. Hit directly by the
 * "Conectar com Google" button (top-level navigation, not fetch —
 * the browser needs to actually leave the app for Google's domain).
 */
export async function GET() {
  const account = await getAuthedAccount()
  if (!account) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!account.canEdit) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.redirect(buildGoogleAuthUrl(account.accountId))
}
