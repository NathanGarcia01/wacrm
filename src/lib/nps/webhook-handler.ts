import { supabaseAdmin } from "@/lib/automations/admin-client";
import { runAutomationsForTrigger } from "@/lib/automations/engine";
import { runFlowsForTrigger } from "@/lib/flows/workflow-engine";
import { sendTextMessage } from "@/lib/whatsapp/meta-api";
import { sanitizePhoneForMeta } from "@/lib/whatsapp/phone-utils";

const DEFAULT_FOLLOW_UP_MESSAGE =
  "Obrigado pela sua avaliação! Tem algum comentário adicional? (opcional)";

interface HandleNpsResponseArgs {
  accountId: string;
  conversationId: string;
  contactId: string;
  contactPhone: string;
  phoneNumberId: string;
  accessToken: string;
  /** The inbound message's text content — null/empty for non-text messages. */
  text: string;
}

/**
 * Checks whether this inbound message is answering a pending NPS
 * survey and, if so, consumes it (returns true — the webhook caller
 * must skip flow/automation dispatch for this message).
 *
 * Only ever looks at surveys with status='sent' for this exact
 * conversation — a random text message on a conversation with no
 * pending survey always falls through untouched (returns false).
 *
 * State machine (see 028_nps_settings_and_surveys.sql for why there's
 * no dedicated "awaiting comment" status):
 *   status='sent', rating=null      → expecting a 1-5 rating
 *   status='sent', rating=1..5      → expecting an optional comment
 *   status='responded'/'expired'    → never matched by the query above
 */
export async function handleNpsResponse(args: HandleNpsResponseArgs): Promise<boolean> {
  const db = supabaseAdmin();

  const { data: survey } = await db
    .from("nps_surveys")
    .select("id, rating")
    .eq("conversation_id", args.conversationId)
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!survey) return false;

  if (survey.rating == null) {
    // Accept a leading digit 1-5 (optionally followed by anything —
    // "5 estrelas", "5!", "nota 5" won't match, but a bare "5" or "5 "
    // will, matching the exact reply format the survey message asks for).
    const match = /^\s*([1-5])\s*$/.exec(args.text ?? "");
    if (!match) return false;
    const rating = Number(match[1]);

    const { error: updateErr } = await db
      .from("nps_surveys")
      .update({ rating })
      .eq("id", survey.id);
    if (updateErr) {
      console.error("[nps] failed to save rating:", updateErr.message);
      // Still consume: this reply was clearly meant for the survey, and
      // letting it fall through to keyword-match automations would be
      // more confusing than silently dropping it on a DB error.
      return true;
    }

    // nps_received automations/workflow-flows — fire-and-forget, mirrors
    // the other trigger dispatches in the webhook route.
    const dispatchInput = {
      accountId: args.accountId,
      triggerType: "nps_received" as const,
      contactId: args.contactId,
      context: { conversation_id: args.conversationId, vars: { rating } },
    };
    runAutomationsForTrigger(dispatchInput).catch((err) =>
      console.error("[automations] nps_received dispatch failed:", err),
    );
    runFlowsForTrigger(dispatchInput).catch((err) =>
      console.error("[workflow-engine] nps_received dispatch failed:", err),
    );

    await sendFollowUp(db, args);
    return true;
  }

  // Rating already captured — anything now is the optional comment.
  const { error: commentErr } = await db
    .from("nps_surveys")
    .update({
      comment: args.text || null,
      status: "responded",
      responded_at: new Date().toISOString(),
    })
    .eq("id", survey.id);
  if (commentErr) {
    console.error("[nps] failed to save comment:", commentErr.message);
  }
  return true;
}

async function sendFollowUp(
  db: ReturnType<typeof supabaseAdmin>,
  args: HandleNpsResponseArgs,
): Promise<void> {
  const { data: settings } = await db
    .from("nps_settings")
    .select("follow_up_message")
    .eq("account_id", args.accountId)
    .maybeSingle();
  const followUp = settings?.follow_up_message || DEFAULT_FOLLOW_UP_MESSAGE;

  try {
    const result = await sendTextMessage({
      phoneNumberId: args.phoneNumberId,
      accessToken: args.accessToken,
      to: sanitizePhoneForMeta(args.contactPhone),
      text: followUp,
    });

    await db.from("messages").insert({
      conversation_id: args.conversationId,
      sender_type: "bot",
      content_type: "text",
      content_text: followUp,
      message_id: result.messageId,
      status: "sent",
    });

    await db
      .from("conversations")
      .update({
        last_message_text: followUp,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", args.conversationId);
  } catch (err) {
    // The rating itself is already saved — a failed follow-up send
    // shouldn't roll that back, just log for operator visibility.
    console.error("[nps] follow-up send failed:", err instanceof Error ? err.message : err);
  }
}
