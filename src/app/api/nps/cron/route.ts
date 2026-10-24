import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";

/**
 * Expires NPS surveys nobody responded to within 48h.
 *
 * Used to also dispatch NPS surveys for conversations that had gone
 * quiet past each account's configured inactivity_hours ("inactivity"
 * trigger) — removed per 2026-10-24 decision: NPS now only fires on an
 * explicit conversation close (manual or automation, via
 * sendNpsSurvey's 'manual_close' callers), never on a bare timeout.
 * Root cause this avoids: an "inactivity" survey's own copy says
 * "estamos encerrando nossa conversa" while never actually closing the
 * ticket/conversation — and it was the path responsible for the
 * 2026-10-22 backlog incident (158 free-text sends the moment the cron
 * first ran, 150 outside Meta's 24h window). `nps_settings
   .inactivity_hours` is no longer read anywhere; left in place
 * (unused) rather than migrated away, since the column itself is
 * harmless.
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

  // Whole-route lock (migration 115) — prevents an overlapping
  // invocation from re-running the same expiry sweep. TTL matches the
  // 15-minute schedule this route is meant to run on.
  const { data: acquired, error: lockError } = await db.rpc("try_acquire_cron_lock", {
    p_job_name: "nps-cron",
    p_ttl_seconds: 840,
  });
  if (lockError) {
    return NextResponse.json({ error: lockError.message }, { status: 500 });
  }
  if (!acquired) {
    return NextResponse.json({ skipped: true, reason: "locked" });
  }

  // Expire unanswered surveys past 48h.
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
    dispatched: 0,
    expired: expired?.length ?? 0,
  });
}
