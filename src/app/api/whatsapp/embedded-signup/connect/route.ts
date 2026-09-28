import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { buildMetaOAuthUrl } from '@/lib/whatsapp/embedded-signup'

/**
 * GET /api/whatsapp/embedded-signup/connect
 *
 * Opened directly in the popup window by "Conectar com WhatsApp". Builds
 * the Meta OAuth URL server-side (so META_APP_ID/the redirect URI never
 * need to reach the client) and redirects the popup to Meta's consent
 * dialog. Modeled on /api/integrations/google-sheets/connect.
 */
export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    return NextResponse.redirect(buildMetaOAuthUrl(accountId))
  } catch (err) {
    return toErrorResponse(err)
  }
}
