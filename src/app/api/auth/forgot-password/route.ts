// ============================================================
// POST /api/auth/forgot-password
//
// Moved server-side so the recovery link's redirectTo is a hardcoded
// production URL, never something derived in the browser (env var
// inlined at build time, window.location.origin, etc.) that could
// resolve to the wrong host.
// ============================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const RESET_REDIRECT_TO = "https://www.funilly.tech/auth/callback?next=/reset-password";

let _anonClient: ReturnType<typeof createClient> | null = null;
function supabaseAnon() {
  if (!_anonClient) {
    _anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      // Plain createClient() defaults to flowType 'implicit', unlike
      // @supabase/ssr's browser/server clients (always 'pkce'). Without
      // this, the recovery link comes back as #access_token=... instead
      // of ?code=..., which /auth/callback/route.ts can't read (hash
      // fragments never reach the server) — it falls through to a bare
      // /login redirect instead of /reset-password.
      { auth: { flowType: "pkce" } },
    );
  }
  return _anonClient;
}

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`forgot-password:${ip}`, RATE_LIMITS.forgotPassword);
  if (!limit.success) return rateLimitResponse(limit);

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const { error } = await supabaseAnon().auth.resetPasswordForEmail(email, {
    redirectTo: RESET_REDIRECT_TO,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
