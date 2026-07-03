import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendNpsSurvey } from "@/lib/nps/send-survey";

/**
 * Triggers a one-off NPS survey send for a conversation. Two callers:
 *   - message-thread.tsx fires this (fire-and-forget) right after the
 *     agent closes a conversation.
 *   - The inbox sidebar's "Enviar pesquisa agora" button, for a
 *     conversation that doesn't have a survey yet regardless of its
 *     current status.
 * Both record trigger_type='manual_close' — see the comment on
 * sendNpsSurvey for why the inactivity value doesn't fit either case.
 * Duplicate-send protection and the nps_settings.enabled gate both
 * live in sendNpsSurvey, not here.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const conversationId = body?.conversation_id as string | undefined;
    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
    }

    const result = await sendNpsSurvey({
      accountId,
      userId: user.id,
      conversationId,
      triggerType: "manual_close",
    });

    if (!result.sent) {
      const status = result.reason === "conversation_not_found" ? 404 : 409;
      return NextResponse.json({ error: result.reason }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in NPS send POST:", error);
    return NextResponse.json({ error: "Failed to send NPS survey" }, { status: 500 });
  }
}
