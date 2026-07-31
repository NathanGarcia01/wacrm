import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Exchanges the PKCE `code` Supabase puts on password-recovery (and
// email-confirmation) links for a real session, then forwards the
// visitor to whatever page requested the link via `next` — e.g.
// /forgot-password sends people here with `next=/reset-password`.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // Most common cause: the PKCE code_verifier cookie set when the
    // recovery/signup link was requested only lives in that same
    // browser — clicking the emailed link from a different browser or
    // device (very common: request on desktop, open the email on
    // phone) makes this exchange fail every time, not just sometimes.
    // Previously this fell through to a bare /login redirect with no
    // explanation, which reads as "the link does nothing".
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
    if (next === "/reset-password") {
      return NextResponse.redirect(`${origin}/forgot-password?error=link_expired`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
