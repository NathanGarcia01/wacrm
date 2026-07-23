// ============================================================
// POST /api/auth/welcome-email
//
// Fired by the signup page right after supabase.auth.signUp()
// succeeds. Public (no session required) because a project with
// email confirmation enabled has no live session yet at that point —
// the client only has the freshly created user's id.
//
// Security model
//   - Takes a `userId`, never an email/name — the recipient address
//     and display name are always looked up server-side from the
//     canonical auth.users record, so this endpoint can't be used to
//     spam an arbitrary address of the caller's choosing.
//   - Only sends for accounts created in the last few minutes. A
//     leaked/enumerated user id older than that is a no-op, which
//     closes off "replay this endpoint later" as a way to re-trigger
//     mail for someone else's account.
//   - Per-IP rate limit on top, same pattern as the invitation peek
//     route.
//   - Best-effort throughout: any failure (missing config, Resend
//     error, unknown user) returns 200 rather than surfacing an error
//     to the signup flow, which must never block on this.
// ============================================================

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { getResendClient, getWelcomeEmailFrom } from "@/lib/email/resend-client";
import { welcomeEmailHtml } from "@/lib/email/templates/welcome-email";

let _adminClient: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

const MAX_ACCOUNT_AGE_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`welcome-email:${ip}`, RATE_LIMITS.welcomeEmail);
  if (!limit.success) return rateLimitResponse(limit);

  let body: { userId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId : null;
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  const user = data?.user;

  // Never leak whether a user id exists — every "can't send" path
  // below returns the same ok:true shape as a real success.
  if (error || !user?.email) {
    return NextResponse.json({ ok: true });
  }

  const createdAtMs = user.created_at ? new Date(user.created_at).getTime() : 0;
  if (!createdAtMs || Date.now() - createdAtMs > MAX_ACCOUNT_AGE_MS) {
    return NextResponse.json({ ok: true });
  }

  const resend = getResendClient();
  if (!resend) {
    console.error("[welcome-email] RESEND_API_KEY not configured — skipping send");
    return NextResponse.json({ ok: true });
  }

  const name =
    typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";

  try {
    await resend.emails.send({
      from: getWelcomeEmailFrom(),
      to: user.email,
      subject: "Bem-vindo ao Funilly! Seu trial gratuito começou 🚀",
      html: welcomeEmailHtml({ name }),
    });
  } catch (err) {
    console.error("[welcome-email] failed to send:", err);
  }

  return NextResponse.json({ ok: true });
}
