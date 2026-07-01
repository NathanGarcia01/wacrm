import { NextResponse } from 'next/server'
import { ADMIN_COOKIE_NAME, isValidAdminPassword, signAdminCookie } from '@/lib/admin/auth'

/**
 * POST /api/admin/login — the only unauthenticated entry point into
 * the admin panel. Checks the submitted password against
 * ADMIN_SECRET and, on success, sets the static HMAC session cookie
 * that the middleware and every /api/admin/* route then check.
 */
export async function POST(request: Request) {
  const secret = process.env.ADMIN_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Admin panel not configured' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const password = typeof body.password === 'string' ? body.password : ''

  if (!isValidAdminPassword(password, secret)) {
    return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
  }

  const cookieValue = await signAdminCookie(secret)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ADMIN_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // No maxAge — session cookie by design. The password gate itself
    // (re-typed each browser session) is the re-auth boundary, not a
    // token expiry.
  })
  return response
}
