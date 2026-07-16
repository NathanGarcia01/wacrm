import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from './encryption'

/**
 * Multi-channel WhatsApp credential resolution.
 *
 * Every send/receive path used to do its own
 * `.from('whatsapp_config').select('*').eq('account_id', accountId).single()`
 * + `decrypt(config.access_token)`. This module centralizes that lookup
 * behind a single fallback chain so all ~9 call sites agree on which
 * number to use:
 *
 *   canal específico (channel_id da conversa/broadcast)
 *     → canal is_default da conta (whatsapp_channels)
 *     → linha legada em whatsapp_config
 *     → variáveis de ambiente (WHATSAPP_TOKEN / NEXT_PUBLIC_WHATSAPP_PHONE_NUMBER_ID)
 *
 * See migration 036_whatsapp_channels.sql for how whatsapp_config rows
 * got backfilled into whatsapp_channels — the legacy-row fallback here
 * exists for accounts that predate that backfill (e.g. a fresh clone of
 * an older DB snapshot) rather than as an expected steady-state path.
 */

export interface ResolvedChannel {
  /** null when resolved from the legacy whatsapp_config row or env vars —
   *  there's no whatsapp_channels row to attribute the send/receive to. */
  channelId: string | null
  phoneNumberId: string
  wabaId: string | null
  accessToken: string
}

async function fromLegacyConfig(
  admin: SupabaseClient,
  accountId: string,
): Promise<ResolvedChannel | null> {
  const { data } = await admin
    .from('whatsapp_config')
    .select('phone_number_id, waba_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data) return null
  return {
    channelId: null,
    phoneNumberId: data.phone_number_id,
    wabaId: data.waba_id ?? null,
    accessToken: decrypt(data.access_token),
  }
}

function fromEnv(): ResolvedChannel | null {
  const phoneNumberId = process.env.NEXT_PUBLIC_WHATSAPP_PHONE_NUMBER_ID
  const accessToken = process.env.WHATSAPP_TOKEN
  if (!phoneNumberId || !accessToken) return null
  return { channelId: null, phoneNumberId, wabaId: null, accessToken }
}

/**
 * The account's send-by-default number: the whatsapp_channels row
 * flagged is_default (falling back to any other active channel if none
 * is flagged — the channels API enforces "exactly one default", but this
 * keeps a send working even if that invariant is ever violated). Falls
 * further back to the pre-multi-channel whatsapp_config row, then to the
 * WHATSAPP_TOKEN / NEXT_PUBLIC_WHATSAPP_PHONE_NUMBER_ID env vars — the
 * original single-tenant deployment path.
 */
export async function resolveDefaultChannel(
  admin: SupabaseClient,
  accountId: string,
): Promise<ResolvedChannel | null> {
  const { data } = await admin
    .from('whatsapp_channels')
    .select('id, phone_number_id, waba_id, access_token_encrypted')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (data) {
    return {
      channelId: data.id,
      phoneNumberId: data.phone_number_id,
      wabaId: data.waba_id ?? null,
      accessToken: decrypt(data.access_token_encrypted),
    }
  }

  return (await fromLegacyConfig(admin, accountId)) ?? fromEnv()
}

/**
 * Resolve a conversation's / broadcast's specific channel_id. Falls back
 * to resolveDefaultChannel when the id is null, the row was deleted, it
 * belongs to a different account, or it's been deactivated — a channel
 * going away must never hard-fail an in-flight send.
 */
export async function resolveChannelById(
  admin: SupabaseClient,
  channelId: string | null | undefined,
  accountId: string,
): Promise<ResolvedChannel | null> {
  if (!channelId) return resolveDefaultChannel(admin, accountId)

  const { data } = await admin
    .from('whatsapp_channels')
    .select('id, phone_number_id, waba_id, access_token_encrypted')
    .eq('id', channelId)
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle()

  if (!data) return resolveDefaultChannel(admin, accountId)

  return {
    channelId: data.id,
    phoneNumberId: data.phone_number_id,
    wabaId: data.waba_id ?? null,
    accessToken: decrypt(data.access_token_encrypted),
  }
}

/**
 * Inbound webhook lookup: Meta tells us which phone_number_id received
 * the message, not which account it belongs to. Scans whatsapp_channels
 * globally (mirrors the pre-multi-channel whatsapp_config lookup this
 * replaces in src/app/api/whatsapp/webhook/route.ts) and falls back to
 * whatsapp_config for accounts that haven't been backfilled into a
 * channel yet.
 */
export async function resolveChannelByPhoneNumberId(
  admin: SupabaseClient,
  phoneNumberId: string,
): Promise<(ResolvedChannel & { accountId: string }) | null> {
  const { data: channelRows, error: channelError } = await admin
    .from('whatsapp_channels')
    .select('id, account_id, phone_number_id, waba_id, access_token_encrypted')
    .eq('phone_number_id', phoneNumberId)

  if (channelError) {
    console.error(
      'Error fetching whatsapp_channels for phone_number_id:',
      phoneNumberId,
      channelError,
    )
    return null
  }

  if (channelRows && channelRows.length === 1) {
    const row = channelRows[0]
    return {
      channelId: row.id,
      accountId: row.account_id,
      phoneNumberId: row.phone_number_id,
      wabaId: row.waba_id ?? null,
      accessToken: decrypt(row.access_token_encrypted),
    }
  }

  if (channelRows && channelRows.length > 1) {
    console.error(
      `Multiple whatsapp_channels (${channelRows.length}) found for phone_number_id:`,
      phoneNumberId,
      '— inbound message dropped. Each phone number must map to exactly one channel.',
    )
    return null
  }

  // No channel row — fall back to the legacy singleton, scoped the same
  // way the pre-multi-channel webhook handler did.
  const { data: configRows, error: configError } = await admin
    .from('whatsapp_config')
    .select('account_id, phone_number_id, waba_id, access_token')
    .eq('phone_number_id', phoneNumberId)

  if (configError) {
    console.error(
      'Error fetching whatsapp_config for phone_number_id:',
      phoneNumberId,
      configError,
    )
    return null
  }
  if (!configRows || configRows.length !== 1) return null

  const row = configRows[0]
  return {
    channelId: null,
    accountId: row.account_id,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id ?? null,
    accessToken: decrypt(row.access_token),
  }
}

/**
 * Audit "owner" for inserts with a NOT NULL user_id FK (contacts,
 * conversations) that don't have one single natural author — e.g. an
 * inbound webhook message, or a broadcast send. Sourced from
 * accounts.owner_user_id rather than a channel's creator so it stays
 * stable regardless of which channel actually handled the message.
 */
export async function resolveAccountOwnerUserId(
  admin: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle()
  return data?.owner_user_id ?? null
}
