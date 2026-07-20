import crypto from 'crypto'
import { google } from 'googleapis'

export const GOOGLE_SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
]

const STATE_TTL_MS = 10 * 60 * 1000

export function googleOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  )
}

function stateHmacKey(): Buffer {
  return Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')
}

/**
 * Signs `accountId` + a nonce + timestamp into an opaque `state` value
 * for the OAuth redirect round-trip. Verified on callback so the
 * request can't be forged (CSRF) and can't be replayed after
 * `STATE_TTL_MS`.
 */
export function signOAuthState(accountId: string): string {
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

export function verifyOAuthState(state: string): { accountId: string } | null {
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

export function buildGoogleAuthUrl(accountId: string): string {
  const client = googleOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    // Forces Google to reissue a refresh_token even for a user who
    // authorized before — without it, a reconnect after a revoked/lost
    // refresh_token would silently get none back.
    prompt: 'consent',
    scope: GOOGLE_SHEETS_SCOPES,
    state: signOAuthState(accountId),
  })
}

export interface GoogleTokens {
  access_token: string
  refresh_token: string
  expiry_date: number
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const client = googleOAuthClient()
  const { tokens } = await client.getToken(code)
  if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
    throw new Error(
      'Google did not return a refresh_token — reconnect with prompt=consent (already default) and make sure this is a first-time authorization or a previous grant was revoked.',
    )
  }
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  }
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<{
  access_token: string
  expiry_date: number
}> {
  const client = googleOAuthClient()
  client.setCredentials({ refresh_token: refreshToken })
  const { credentials } = await client.refreshAccessToken()
  if (!credentials.access_token || !credentials.expiry_date) {
    throw new Error('Google refresh_token exchange returned no access_token')
  }
  return { access_token: credentials.access_token, expiry_date: credentials.expiry_date }
}
