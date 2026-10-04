/**
 * Meta "Embedded Signup" OAuth helpers — the JS SDK based flow (FB.login +
 * config_id) that lets an account connect a WhatsApp Cloud API number
 * without pasting a token by hand. The popup itself and the WABA/number
 * picker are entirely Meta's own Embedded Signup UI; this file only trades
 * the `code` it hands back for an access token.
 */

import { META_API_VERSION, MetaApiError, throwMetaError } from './meta-api'

const META_OAUTH_BASE = `https://graph.facebook.com/${META_API_VERSION}`

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name}`)
  return value
}

export interface MetaOAuthToken {
  accessToken: string
  expiresInSeconds: number
}

/**
 * Trades the `code` returned by FB.login (config_id-based Embedded Signup)
 * for a short-lived (~1-2h) User access token. No redirect_uri: unlike the
 * classic OAuth dialog, the JS SDK flow never redirects anywhere — Meta
 * rejects the exchange if redirect_uri is sent.
 */
export async function exchangeCodeForUserToken(code: string): Promise<MetaOAuthToken> {
  const params = new URLSearchParams({
    client_id: requireEnv('META_APP_ID'),
    client_secret: requireEnv('META_APP_SECRET'),
    code,
  })
  const response = await fetch(`${META_OAUTH_BASE}/oauth/access_token?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta OAuth code exchange failed: ${response.status}`)
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) {
    throw new MetaApiError('Meta OAuth code exchange returned no access_token')
  }
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in ?? 0 }
}

/**
 * Step 2 — trades the short-lived token for a long-lived one (~60 days).
 * Required: whatsapp_channels has no refresh-token/expiry column, so the
 * token that ends up stored must already be the long-lived one, or the
 * channel silently stops working within a couple of hours.
 */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<MetaOAuthToken> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: requireEnv('META_APP_ID'),
    client_secret: requireEnv('META_APP_SECRET'),
    fb_exchange_token: shortLivedToken,
  })
  const response = await fetch(`${META_OAUTH_BASE}/oauth/access_token?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta long-lived token exchange failed: ${response.status}`)
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) {
    throw new MetaApiError('Meta long-lived token exchange returned no access_token')
  }
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in ?? 0 }
}
