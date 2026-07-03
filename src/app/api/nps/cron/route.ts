import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { sendNpsSurvey } from "@/lib/nps/send-survey";

/**
 * Two jobs, one schedule (meant to be hit every 15-30min by the same
 * external pinger driving /api/automations/cron):
 *   1. Dispatch NPS surveys for conversations that have gone quiet
 *      past each account's configured inactivity_hours.
 *   2. Expire surveys nobody responded to within 48h.
 *
 * Auth: reuses AUTOMATION_CRON_SECRET so operators only have one
 * secret to provision — same pattern as /api/flows/cron.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  const supplied = request.headers.get("x-cron-secret");
  if (supplied !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  let dispatched = 0;

  // --- 1. Inactivity dispatch, per enabled account -----------------
  const { data: settingsRows, error: settingsError } = await db
    .from("nps_settings")
    .select("account_id, inactivity_hours, accounts(owner_user_id)")
    .eq("enabled", true);

  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 500 });
  }

  for (const row of (settingsRows ?? []) as unknown as {
    account_id: string;
    inactivity_hours: number;
    accounts: { owner_user_id: string } | { owner_user_id: string }[] | null;
  }[]) {
    const ownerRow = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
    const ownerUserId = ownerRow?.owner_user_id;
    if (!ownerUserId) continue;

    const cutoff = new Date(Date.now() - row.inactivity_hours * 60 * 60 * 1000).toISOString();

    const [{ data: staleConvs }, { data: alreadySurveyed }] = await Promise.all([
      db
        .from("conversations")
        .select("id")
        .eq("account_id", row.account_id)
        .eq("status", "open")
        .lt("last_message_at", cutoff)
        .not("last_message_at", "is", null)
        .order("last_message_at", { ascending: true })
        .limit(50),
      db.from("nps_surveys").select("conversation_id").eq("account_id", row.account_id),
    ]);

    const surveyed = new Set((alreadySurveyed ?? []).map((s) => s.conversation_id as string));
    const due = (staleConvs ?? []).filter((c) => !surveyed.has(c.id as string));

    for (const conv of due) {
      const result = await sendNpsSurvey({
        accountId: row.account_id,
        userId: ownerUserId,
        conversationId: conv.id as string,
        triggerType: "inactivity",
      });
      if (result.sent) dispatched++;
    }
  }

  // --- 2. Expire unanswered surveys past 48h ------------------------
  const expiryCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: expired, error: expireError } = await db
    .from("nps_surveys")
    .update({ status: "expired" })
    .eq("status", "sent")
    .lt("sent_at", expiryCutoff)
    .select("id");

  if (expireError) {
    console.error("[nps cron] expiry update failed:", expireError.message);
  }

  return NextResponse.json({
    dispatched,
    expired: expired?.length ?? 0,
  });
}
