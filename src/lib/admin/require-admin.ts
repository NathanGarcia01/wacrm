import { cookies } from 'next/headers'
import { ADMIN_COOKIE_NAME, isValidAdminCookie } from './auth'

/**
 * Session check for `/api/admin/*` route handlers (Node runtime —
 * middleware already gates the `/admin/*` *pages*, but API routes are
 * hit directly and re-check independently rather than trusting the
 * middleware pass-through).
 */
export async function requireAdminSession(): Promise<boolean> {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return false
  const cookieStore = await cookies()
  const value = cookieStore.get(ADMIN_COOKIE_NAME)?.value
  return isValidAdminCookie(value, secret)
}

/**
 * True if the request carries a valid `x-cron-secret` header matching
 * `AUTOMATION_CRON_SECRET`. Lets an external scheduler hit
 * POST /api/admin/mrr-snapshot without an admin cookie — mirrors the
 * pattern in /api/automations/cron.
 */
export function hasValidCronSecret(request: Request): boolean {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) return false
  const supplied = request.headers.get('x-cron-secret')
  return supplied === expected
}
