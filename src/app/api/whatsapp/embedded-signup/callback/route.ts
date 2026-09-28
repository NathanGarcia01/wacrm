import { NextResponse } from 'next/server'
import {
  exchangeCodeForUserToken,
  exchangeForLongLivedToken,
  listEmbeddedSignupAssets,
  verifyEmbeddedSignupState,
} from '@/lib/whatsapp/embedded-signup'
import { createEmbeddedSignupSession } from '@/lib/whatsapp/embedded-signup-session'

const CONNECT_PAGE = '/whatsapp-connect'

/**
 * GET /api/whatsapp/embedded-signup/callback
 *
 * Meta redirects the popup here after the user approves (or denies) the
 * consent dialog. Runs with no user session of its own — the browser just
 * came back from facebook.com — so identity comes entirely from the
 * `state` signed in /connect, exactly like /api/auth/google/callback.
 *
 * On success, stores the long-lived token + WABA/number list server-side
 * (see embedded-signup-session.ts for why — never in the URL) and sends
 * the popup on to the number picker page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  if (oauthError) {
    return NextResponse.redirect(new URL(`${CONNECT_PAGE}?error=meta_denied`, request.url))
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL(`${CONNECT_PAGE}?error=missing_params`, request.url))
  }

  const verified = verifyEmbeddedSignupState(state)
  if (!verified) {
    return NextResponse.redirect(new URL(`${CONNECT_PAGE}?error=invalid_state`, request.url))
  }

  try {
    const shortLived = await exchangeCodeForUserToken(code)
    const longLived = await exchangeForLongLivedToken(shortLived.accessToken)
    const wabas = await listEmbeddedSignupAssets(longLived.accessToken)

    if (wabas.every((w) => w.phoneNumbers.length === 0)) {
      return NextResponse.redirect(new URL(`${CONNECT_PAGE}?error=no_numbers`, request.url))
    }

    const sessionId = await createEmbeddedSignupSession({
      accountId: verified.accountId,
      longLivedToken: longLived.accessToken,
      wabas,
    })

    return NextResponse.redirect(new URL(`${CONNECT_PAGE}?session=${sessionId}`, request.url))
  } catch (err) {
    console.error('[embedded-signup/callback] failed:', err)
    return NextResponse.redirect(new URL(`${CONNECT_PAGE}?error=meta_api_failed`, request.url))
  }
}
