import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAutomationDraft } from "@/lib/ai/generate-automation";

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
