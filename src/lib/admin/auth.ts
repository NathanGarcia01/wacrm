// Admin-panel session cookie — signed, expiring, and identifies a
// specific `admin_users` row (id). Replaces the old single-shared-
// password model (a static HMAC of ADMIN_SECRET, same value for
// every login, no identity at all) now that /admin supports
// per-person accounts with roles.
//
// Cookie value: `${adminId}.${exp}.${hmacHex(secret, adminId+"."+exp)}`
// — a minimal signed token, not a JWT library, so it stays on Web
// Crypto (`crypto.subtle`) and runs identically in the Edge
// middleware and Node route handlers without a runtime split. The
// signing secret is ADMIN_SECRET, repurposed from "the password
// itself" to "the key that signs sessions" — it's no longer typed
// into the login form.
//
// This is intentionally NOT a full session-store: there's no way to
// revoke one issued cookie early short of rotating ADMIN_SECRET
// (which invalidates every session at once) or waiting out its TTL.
// Acceptable for a 2-person internal ops panel.

export const ADMIN_COOKIE_NAME = 'wacrm_admin_session'

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000 // 12h

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

/** Constant-time string compare — avoids leaking length/prefix via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export interface AdminSessionToken {
  adminId: string
  exp: number
}

/** Value to store in the admin cookie once a login password check passes. */
export async function signSessionCookie(
  adminId: string,
  secret: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<{ value: string; exp: number }> {
  const exp = Date.now() + ttlMs
  const payload = `${adminId}.${exp}`
  const sig = await hmacHex(secret, payload)
  return { value: `${payload}.${sig}`, exp }
}

/**
 * Verifies signature + expiry only — pure crypto, no DB lookup, so
 * this is what the Edge middleware calls. It does NOT confirm the
 * admin_users row still exists/is active/has a given role; that's
 * `requireAdminUser()`'s job (Node runtime, re-checked independently
 * per route — see require-admin.ts).
 */
export async function verifySessionCookie(
  cookieValue: string | undefined | null,
  secret: string,
): Promise<AdminSessionToken | null> {
  if (!cookieValue || !secret) return null
  const parts = cookieValue.split('.')
  if (parts.length !== 3) return null
  const [adminId, expStr, sig] = parts
  const exp = Number(expStr)
  if (!adminId || !Number.isFinite(exp)) return null
  if (Date.now() > exp) return null

  const expected = await hmacHex(secret, `${adminId}.${expStr}`)
  if (!timingSafeEqual(sig, expected)) return null

  return { adminId, exp }
}
