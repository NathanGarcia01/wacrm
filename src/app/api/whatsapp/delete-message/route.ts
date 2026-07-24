import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deleteWhatsAppMessage, MetaApiError } from '@/lib/whatsapp/meta-api';
import { resolveChannelById } from '@/lib/whatsapp/channels';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * POST /api/whatsapp/delete-message
 *
 * Body: { message_id: <internal UUID> }
 *
 * Best-effort deletes the message on Meta's side (DELETE on the
 * message node, using the account's access token — never exposed to
 * the client), then always stamps `messages.deleted_at` locally so the
 * bubble hides regardless of whether Meta accepted the delete. Not
 * every message is eligible for remote deletion (age, type, delivery
 * state); a Meta failure is reported back to the caller but does not
 * block the local soft-delete.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = checkRateLimit(`delete-message:${user.id}`, RATE_LIMITS.deleteMessage);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { message_id } = body as { message_id?: string };

    if (!message_id) {
      return NextResponse.json({ error: 'message_id is required' }, { status: 400 });
    }

    const { data: targetMessage, error: msgError } = await supabase
      .from('messages')
      .select('id, message_id, conversation_id, deleted_at')
      .eq('id', message_id)
      .maybeSingle();

    if (msgError || !targetMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (targetMessage.deleted_at) {
      // Already deleted — idempotent no-op.
      return NextResponse.json({ success: true });
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, account_id, channel_id')
      .eq('id', targetMessage.conversation_id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    let metaError: string | undefined;

    if (targetMessage.message_id) {
      const config = await resolveChannelById(supabase, conversation.channel_id, accountId);
      if (!config) {
        metaError = 'WhatsApp not configured.';
        console.error('[whatsapp/delete-message] no channel config for account', accountId);
      } else {
        try {
          await deleteWhatsAppMessage({
            accessToken: config.accessToken,
            messageId: targetMessage.message_id,
          });
        } catch (err) {
          metaError =
            err instanceof MetaApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Unknown Meta API error';
          console.error('[whatsapp/delete-message] Meta delete failed:', metaError);
        }
      }
    } else {
      // No Meta id (e.g. a failed/never-sent agent message) — nothing
      // to ask Meta to delete, just soft-delete locally below.
      metaError = undefined;
    }

    const { error: updateError } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', message_id);

    if (updateError) {
      console.error('[whatsapp/delete-message] DB update failed:', updateError.message);
      return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
    }

    return NextResponse.json({ success: true, metaError });
  } catch (error) {
    console.error('Error in WhatsApp delete-message POST:', error);
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
  }
}
