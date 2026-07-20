import { NextResponse } from 'next/server'
import { exchangeCodeForTokens, verifyOAuthState } from '@/lib/integrations/google-oauth'
import { saveTokens } from '@/lib/integrations/google-sheets'

const RETURN_PATH = '/settings?tab=integrations'

/**
 * GET /api/auth/google/callback
 *
 * Google redirects here after the consent screen. `state` (signed at
 * /connect) both proves the request wasn't forged and carries the
 * account_id to attach the tokens to — this route runs with no user
 * session of its own, since the browser only just came back from
 * Google's domain.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  if (oauthError) {
    return NextResponse.redirect(
      new URL(`${RETURN_PATH}&google_error=${encodeURIComponent(oauthError)}`, request.url),
    )
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL(`${RETURN_PATH}&google_error=missing_params`, request.url))
  }

  const verified = verifyOAuthState(state)
  if (!verified) {
    return NextResponse.redirect(new URL(`${RETURN_PATH}&google_error=invalid_state`, request.url))
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    await saveTokens(verified.accountId, tokens)
    return NextResponse.redirect(new URL(`${RETURN_PATH}&google_connected=1`, request.url))
  } catch (err) {
    console.error('[auth/google/callback] token exchange failed:', err)
    return NextResponse.redirect(new URL(`${RETURN_PATH}&google_error=token_exchange_failed`, request.url))
  }
}
