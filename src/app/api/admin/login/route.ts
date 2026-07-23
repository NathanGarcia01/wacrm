import { NextResponse } from 'next/server'
import { ADMIN_COOKIE_NAME, signSessionCookie } from '@/lib/admin/auth'
import { supabaseAdmin } from '@/lib/admin/admin-client'
import { verifyPassword } from '@/lib/admin/password'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

/**
 * POST /api/admin/login — the only unauthenticated entry point into
 * the admin panel. Looks up `admin_users` by email (case-insensitive),
 * verifies the password hash, and on success sets a signed, expiring
 * session cookie identifying that admin — see src/lib/admin/auth.ts.
 *
 * Same response for "no such email," "wrong password," and "account
 * deactivated" (generic "Email ou senha incorretos") — doesn't leak
 * which part failed.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request)
  const limit = checkRateLimit(`admin-login:${ip}`, RATE_LIMITS.adminLogin)
  if (!limit.success) return rateLimitResponse(limit)

  const secret = process.env.ADMIN_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Admin panel not configured' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    return NextResponse.json({ error: 'Email e senha são obrigatórios' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: user } = await admin
    .from('admin_users')
    .select('id, password_hash, is_active')
    .ilike('email', email)
    .maybeSingle()

  const genericError = () =>
    NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 })

  if (!user || !user.is_active) return genericError()

  const passwordOk = await verifyPassword(password, user.password_hash as string)
  if (!passwordOk) return genericError()

  const { value: cookieValue, exp } = await signSessionCookie(user.id as string, secret)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ADMIN_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(exp),
  })
  return response
}
