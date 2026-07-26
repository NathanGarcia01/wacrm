import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAutomationDraft } from "@/lib/ai/generate-automation";
import { getAccountPlanFeatures } from "@/lib/billing/server";

/**
 * POST /api/ai/generate-automation
 *
 * Body: { description: string }
 *
 * Turns a natural-language description into an automation draft (not
 * persisted) for the "Criar com IA" modal preview. The client saves the
 * draft afterward via the existing POST /api/automations.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Plan gate — hasAI is Business-only. Checked server-side (not just
  // the modal hiding its trigger button) so a direct call to this
  // route can't bypass it.
  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const accountId = profile?.account_id as string | undefined;
  if (!accountId) {
    return NextResponse.json({ error: "Your profile is not linked to an account." }, { status: 403 });
  }
  const features = await getAccountPlanFeatures(supabase, accountId);
  if (!features.hasAI) {
    return NextResponse.json(
      { error: "Automações com IA não estão disponíveis no seu plano atual. Faça upgrade para o plano Business." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as { description?: string } | null;
  const description = body?.description?.trim();
  if (!description) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const result = await generateAutomationDraft(description);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ draft: result.draft });
}
