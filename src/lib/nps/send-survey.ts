import { supabaseAdmin } from "@/lib/automations/admin-client";
import { engineSendText } from "@/lib/automations/meta-send";
import type { NpsTriggerType } from "@/types";

const DEFAULT_MESSAGE_TEMPLATE =
  "Olá! Como você avalia o atendimento que recebeu? Responda com um número de 1 a 5, onde 1 = Péssimo e 5 = Excelente. 😊";

interface SendNpsSurveyArgs {
  accountId: string;
  /** Audit / sender-of-record passed through to engineSendText. */
  userId: string;
  conversationId: string;
  triggerType: NpsTriggerType;
}

export type SendNpsSurveyResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | "disabled"
        | "already_sent"
        | "conversation_not_found"
        | "no_contact"
        | "send_failed"
        | "skipped_backlog"
        | "has_open_deal";
    };

/** Meta's customer-service window for free-text (non-template) sends —
 *  NPS uses engineSendText, not a template, so a contact silent longer
 *  than this can't be reached at all. Incident 2026-10-22: funilly-nps
 *  had never run, so its first tick treated months of quiet
 *  conversations as "due now" and fired 158 free-text sends in one
 *  pass — 150 failed because the window had long since closed. */
const META_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Single entry point for sending a post-conversation NPS survey.
 * Shared by three callers: the manual-close trigger
 * (POST /api/nps/send with trigger_type='manual_close'), the
 * inactivity cron (GET /api/nps/cron), and the inbox sidebar's
 * "Enviar pesquisa agora" button (also 'manual_close' — the
 * nps_surveys.trigger_type CHECK constraint only allows
 * 'manual_close' | 'inactivity', and a human-initiated send is
 * closer in spirit to the former than to an inactivity timeout).
 *
 * Resend gating is enforced here, not by a unique constraint: at most
 * one survey per CONTACT per rolling 24h, regardless of how many
 * conversations/attendances (closes + reopens) happened in that
 * window. A contact-scoped check (rather than the old
 * conversation-scoped one keyed off `conversations.reopened_at`) is
 * required because this CRM keeps exactly one `conversations` row per
 * contact forever (a closed conversation reopens on the next inbound
 * message rather than getting a new row — see
 * findOrCreateConversation): a contact whose conversation gets
 * closed/reopened several times in one day (agent closes, customer
 * writes back, closes again, …) would otherwise get a fresh survey on
 * every reopen, since each reopen bumps `reopened_at` past any prior
 * survey. See the "1 por cliente por dia" fix.
 */
export async function sendNpsSurvey(args: SendNpsSurveyArgs): Promise<SendNpsSurveyResult> {
  const db = supabaseAdmin();

  const { data: conversation } = await db
    .from("conversations")
    .select("id, contact_id, assigned_agent_id")
    .eq("id", args.conversationId)
    .eq("account_id", args.accountId)
    .maybeSingle();

  if (!conversation) {
    return { sent: false, reason: "conversation_not_found" };
  }
  if (!conversation.contact_id) {
    // Contact was deleted (ON DELETE SET NULL) — nothing to send to.
    return { sent: false, reason: "no_contact" };
  }

  // 2026-10-24 decision — never survey a contact with an open deal,
  // regardless of trigger (manual close, automation, etc.): asking for
  // a satisfaction rating mid-negotiation reads as premature/odd, and
  // risks souring an still-open sale. Checked before claiming a slot
  // so a contact with an open deal never even gets a placeholder row.
  const { count: openDealCount } = await db
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", conversation.contact_id)
    .eq("status", "open");
  if ((openDealCount ?? 0) > 0) {
    return { sent: false, reason: "has_open_deal" };
  }

  const { data: settings } = await db
    .from("nps_settings")
    .select("*")
    .eq("account_id", args.accountId)
    .maybeSingle();

  // No settings row yet == feature not configured but not opted out —
  // matches the `enabled` column's own DB default of `true`.
  const enabled = settings?.enabled ?? true;
  if (!enabled) {
    return { sent: false, reason: "disabled" };
  }

  // Atomic claim (migration 115) — the dedup check and the placeholder
  // row insert happen in one DB statement, serialized per account+contact
  // via an advisory lock inside the RPC. Replaces the old check-then-act
  // SELECT: two concurrent cron ticks could both pass that check before
  // either inserted, and both send the WhatsApp message since the send
  // happened before the insert. Only one caller gets a non-null id back.
  const { data: claimedId, error: claimError } = await db.rpc("claim_nps_survey_slot", {
    p_account_id: args.accountId,
    p_contact_id: conversation.contact_id,
    p_conversation_id: args.conversationId,
    p_assigned_agent_id: conversation.assigned_agent_id ?? null,
    p_trigger_type: args.triggerType,
  });
  if (claimError) {
    console.error("[nps] claim_nps_survey_slot failed:", claimError.message);
    return { sent: false, reason: "send_failed" };
  }
  if (!claimedId) {
    return { sent: false, reason: "already_sent" };
  }

  // Backlog guard — re-checks the REAL Meta window (last inbound from
  // the customer), not conversations.last_message_at, which gets
  // overwritten by the bot's own messages (including this one) and so
  // can't be trusted to reflect customer silence.
  const { data: lastCustomerMsg } = await db
    .from("messages")
    .select("created_at")
    .eq("conversation_id", args.conversationId)
    .eq("sender_type", "customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const withinWindow =
    !!lastCustomerMsg?.created_at &&
    Date.now() - new Date(lastCustomerMsg.created_at).getTime() < META_WINDOW_MS;
  if (!withinWindow) {
    await db.from("nps_surveys").update({ status: "skipped_backlog" }).eq("id", claimedId);
    return { sent: false, reason: "skipped_backlog" };
  }

  const messageTemplate = settings?.message_template || DEFAULT_MESSAGE_TEMPLATE;

  try {
    await engineSendText({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: conversation.contact_id,
      text: messageTemplate,
    });
  } catch (err) {
    console.error("[nps] failed to send survey:", err instanceof Error ? err.message : err);
    // Release the claim — status 'failed' falls outside the dedup
    // window so the next cron tick (or a manual resend) can retry.
    await db.from("nps_surveys").update({ status: "failed" }).eq("id", claimedId);
    return { sent: false, reason: "send_failed" };
  }

  const { error: updateError } = await db
    .from("nps_surveys")
    .update({ status: "sent" })
    .eq("id", claimedId);
  if (updateError) {
    console.error("[nps] survey sent but status update failed:", updateError.message);
  }

  return { sent: true };
}
