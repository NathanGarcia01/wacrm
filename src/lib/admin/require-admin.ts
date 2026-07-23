import { cookies } from 'next/headers'
import { ADMIN_COOKIE_NAME, verifySessionCookie } from './auth'
import { supabaseAdmin } from './admin-client'
import type { AdminRole } from './types'

export interface AdminUser {
  id: string
  email: string
  name: string
  role: AdminRole
}

/**
 * Full identity check for `/api/admin/*` route handlers and Server
 * Components — verifies the cookie's signature/expiry (cheap, no DB)
 * then looks up the `admin_users` row itself (id, role, is_active).
 * Middleware only does the first half (see src/middleware.ts); this
 * is the "re-check independently rather than trusting the middleware
 * pass-through" half, now carrying real identity+role instead of a
 * boolean.
 */
export async function requireAdminUser(): Promise<AdminUser | null> {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return null
  const cookieStore = await cookies()
  const token = await verifySessionCookie(cookieStore.get(ADMIN_COOKIE_NAME)?.value, secret)
  if (!token) return null

  const { data, error } = await supabaseAdmin()
    .from('admin_users')
    .select('id, email, name, role, is_active')
    .eq('id', token.adminId)
    .maybeSingle()
  if (error || !data || !data.is_active) return null

  return { id: data.id, email: data.email, name: data.name, role: data.role as AdminRole }
}

/** Thin boolean wrapper — existing call sites that only need "is
 *  someone logged in" (not their role) don't need to change. */
export async function requireAdminSession(): Promise<boolean> {
  return (await requireAdminUser()) !== null
}

/** True if the request carries a valid `x-cron-secret` header matching
 *  `AUTOMATION_CRON_SECRET`. Lets an external scheduler hit
 *  POST /api/admin/mrr-snapshot without an admin cookie — mirrors the
 *  pattern in /api/automations/cron. */
export function hasValidCronSecret(request: Request): boolean {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) return false
  const supplied = request.headers.get('x-cron-secret')
  return supplied === expected
}
