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
      reason: "disabled" | "already_sent" | "conversation_not_found" | "no_contact" | "send_failed";
    };

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
 * Resend cooldown is enforced here, not by a unique constraint: a
 * conversation can get a new survey once any prior sent/responded
 * nps_surveys row for it is more than 30 days old (a customer who
 * reopens a closed conversation and gets helped again is a distinct
 * "attendance" worth its own rating) — expired rows never block a
 * resend regardless of age.
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

  const cooldownCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await db
    .from("nps_surveys")
    .select("id")
    .eq("conversation_id", args.conversationId)
    .in("status", ["sent", "responded"])
    .gte("created_at", cooldownCutoff)
    .maybeSingle();
  if (existing) {
    return { sent: false, reason: "already_sent" };
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
    return { sent: false, reason: "send_failed" };
  }

  const { error: insertError } = await db.from("nps_surveys").insert({
    account_id: args.accountId,
    conversation_id: args.conversationId,
    contact_id: conversation.contact_id,
    assigned_agent_id: conversation.assigned_agent_id ?? null,
    trigger_type: args.triggerType,
    status: "sent",
  });
  if (insertError) {
    // Survey already landed on WhatsApp; log loudly so an operator can
    // backfill the row manually rather than pretending the send failed.
    console.error("[nps] survey sent but DB insert failed:", insertError.message);
    return { sent: false, reason: "send_failed" };
  }

  return { sent: true };
}
