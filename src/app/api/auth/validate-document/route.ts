// ============================================================
// POST /api/auth/validate-document
//
// Called by the signup form BEFORE supabase.auth.signUp() — checksum
// validation needs no DB access and could live entirely client-side,
// but the uniqueness check does (accounts.document, protected by RLS),
// so both live here together as one round trip.
//
// This is the pre-check for UX: it lets the form show "este CPF/CNPJ
// já possui uma conta" *before* creating an auth.users row. It is not
// the only guard — a partial unique index on accounts.document
// (migration 051) is the actual source of truth against a race
// between two concurrent signups for the same document, enforced
// inside the handle_new_user() trigger. If that race is lost here,
// signUp() itself fails (the trigger re-raises), just with a less
// specific error message than this route gives.
//
// Public (no session yet at this point in signup) and rate-limited
// per IP — this is inherently an "does this document exist" oracle,
// so the limit is deliberately tight (see RATE_LIMITS.validateDocument).
// ============================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { onlyDigits, validateDocument } from "@/lib/document";

let _adminClient: ReturnType<typeof createClient> | null = null;
function supabaseAdmin() {
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

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`validate-document:${ip}`, RATE_LIMITS.validateDocument);
  if (!limit.success) return rateLimitResponse(limit);

  let body: { document?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawDocument = typeof body.document === "string" ? body.document : "";
  const digits = onlyDigits(rawDocument);
  const { valid, type } = validateDocument(digits);

  if (!valid || !type) {
    return NextResponse.json(
      { valid: false, error: "CPF ou CNPJ inválido. Confira os números digitados." },
      { status: 200 },
    );
  }

  const admin = supabaseAdmin();
  const { data: existing, error } = await admin
    .from("accounts")
    .select("id")
    .eq("document", digits)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Não foi possível validar o documento agora" }, { status: 500 });
  }

  if (existing) {
    return NextResponse.json(
      { valid: false, error: "Este CPF/CNPJ já possui uma conta cadastrada." },
      { status: 200 },
    );
  }

  return NextResponse.json({ valid: true, type, document: digits });
}
