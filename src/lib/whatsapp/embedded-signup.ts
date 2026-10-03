/**
 * Meta "Embedded Signup" OAuth helpers — the popup-based flow that lets an
 * account connect a WhatsApp Cloud API number without pasting a token by
 * hand. Mirrors the shape of src/lib/integrations/google-oauth.ts, but kept
 * self-contained in the whatsapp/ tree rather than importing from
 * integrations/ (each integration owns its own OAuth helper file in this
 * codebase).
 */

import crypto from 'crypto'
import { META_API_VERSION, MetaApiError, throwMetaError } from './meta-api'

const META_OAUTH_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export const META_EMBEDDED_SIGNUP_SCOPES = [
  'whatsapp_business_management',
  'whatsapp_business_messaging',
]

const STATE_TTL_MS = 10 * 60 * 1000

function stateHmacKey(): Buffer {
  return Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')
}

/**
 * Signs `accountId` + a nonce + timestamp into an opaque `state` value for
 * the OAuth redirect round-trip. Verified on callback so the request can't
 * be forged (CSRF) and can't be replayed after STATE_TTL_MS. A raw
 * `state=accountId` would let anyone forge a callback that attaches a WABA
 * to an arbitrary account.
 */
export function signEmbeddedSignupState(accountId: string): string {
  const payload = JSON.stringify({
    accountId,
    ts: Date.now(),
    nonce: crypto.randomBytes(8).toString('hex'),
  })
  const payloadB64 = Buffer.from(payload).toString('base64url')
  const sig = crypto
    .createHmac('sha256', stateHmacKey())
    .update(payloadB64)
    .digest('base64url')
  return `${payloadB64}.${sig}`
}

export function verifyEmbeddedSignupState(state: string): { accountId: string } | null {
  const parts = state.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, sig] = parts

  const expectedSig = crypto
    .createHmac('sha256', stateHmacKey())
    .update(payloadB64)
    .digest('base64url')

  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (typeof payload.accountId !== 'string' || typeof payload.ts !== 'number') return null
    if (Date.now() - payload.ts > STATE_TTL_MS) return null
    return { accountId: payload.accountId }
  } catch {
    return null
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name}`)
  return value
}

/**
 * Builds the URL to send the popup to for Meta's OAuth consent dialog.
 * Server-only — client never sees META_APP_ID / the redirect URI, it just
 * opens a popup pointed at our own /connect route (which redirects here).
 */
export function buildMetaOAuthUrl(accountId: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv('META_APP_ID'),
    redirect_uri: requireEnv('META_EMBEDDED_SIGNUP_REDIRECT_URI'),
    scope: META_EMBEDDED_SIGNUP_SCOPES.join(','),
    response_type: 'code',
    state: signEmbeddedSignupState(accountId),
  })
  return `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params.toString()}`
}

export interface MetaOAuthToken {
  accessToken: string
  expiresInSeconds: number
}

/**
 * Step 1 of the token exchange — trades the OAuth `code` for a short-lived
 * (~1-2h) User access token.
 */
export async function exchangeCodeForUserToken(code: string): Promise<MetaOAuthToken> {
  const params = new URLSearchParams({
    client_id: requireEnv('META_APP_ID'),
    client_secret: requireEnv('META_APP_SECRET'),
    redirect_uri: requireEnv('META_EMBEDDED_SIGNUP_REDIRECT_URI'),
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

export interface EmbeddedSignupPhoneNumber {
  id: string
  display_phone_number: string
  verified_name?: string
  quality_rating?: string
}

export interface EmbeddedSignupWaba {
  id: string
  name: string
  phoneNumbers: EmbeddedSignupPhoneNumber[]
}

interface MetaBusinessNode {
  id: string
  name?: string
  whatsapp_business_accounts?: {
    data?: Array<{
      id: string
      name?: string
      phone_numbers?: {
        data?: Array<{
          id: string
          display_phone_number?: string
          verified_name?: string
          quality_rating?: string
        }>
      }
    }>
  }
}

/**
 * Fetches every WABA (and its phone numbers) the freshly-authorized token
 * has access to, flattened into a simple array. A business can appear more
 * than once if the token has access via multiple paths, so WABAs are
 * de-duplicated by id.
 */
export async function listEmbeddedSignupAssets(accessToken: string): Promise<EmbeddedSignupWaba[]> {
  const params = new URLSearchParams({
    fields:
      'id,name,whatsapp_business_accounts.limit(50){id,name,phone_numbers.limit(50){id,display_phone_number,verified_name,quality_rating}}',
    access_token: accessToken,
  })
  const response = await fetch(`${META_OAUTH_BASE}/me/businesses?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta /me/businesses failed: ${response.status}`)
  }
  const data = (await response.json()) as { data?: MetaBusinessNode[] }

  const wabaById = new Map<string, EmbeddedSignupWaba>()
  for (const business of data.data ?? []) {
    for (const waba of business.whatsapp_business_accounts?.data ?? []) {
      if (wabaById.has(waba.id)) continue
      wabaById.set(waba.id, {
        id: waba.id,
        name: waba.name || business.name || waba.id,
        phoneNumbers: (waba.phone_numbers?.data ?? []).map((p) => ({
          id: p.id,
          display_phone_number: p.display_phone_number || '',
          verified_name: p.verified_name,
          quality_rating: p.quality_rating,
        })),
      })
    }
  }
  return Array.from(wabaById.values())
}
