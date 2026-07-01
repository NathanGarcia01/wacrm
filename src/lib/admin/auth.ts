// Admin-panel auth — a single shared password (ADMIN_SECRET), not a
// per-user session. The login cookie is a static
// HMAC-SHA256("wacrm-admin-v1", ADMIN_SECRET) hex digest: anyone who
// knows ADMIN_SECRET can derive the same cookie value, so this is
// closer to a long-lived bearer token than a session. Rotating
// ADMIN_SECRET invalidates every existing cookie instantly.
//
// Built on Web Crypto (`crypto.subtle`) instead of Node's `crypto`
// module so the exact same code runs in both the Edge middleware and
// Node route handlers without a runtime split.

export const ADMIN_COOKIE_NAME = 'wacrm_admin_session'

const HMAC_MESSAGE = 'wacrm-admin-v1'

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Value to store in the admin cookie once a login password check passes. */
export async function signAdminCookie(secret: string): Promise<string> {
  return hmacHex(secret, HMAC_MESSAGE)
}

/** Constant-time string compare — avoids leaking length/prefix via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** True iff `cookieValue` is the current valid admin cookie for `secret`. */
export async function isValidAdminCookie(
  cookieValue: string | undefined | null,
  secret: string,
): Promise<boolean> {
  if (!cookieValue || !secret) return false
  const expected = await hmacHex(secret, HMAC_MESSAGE)
  return timingSafeEqual(cookieValue, expected)
}

/** True iff `password` (as typed on /admin/login) matches ADMIN_SECRET. */
export function isValidAdminPassword(
  password: string | undefined | null,
  secret: string,
): boolean {
  if (!password || !secret) return false
  return timingSafeEqual(password, secret)
}
