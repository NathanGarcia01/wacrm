import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

export interface ChannelQualityInfo {
  channelId: string
  name: string
  channelType: 'cloud_api' | 'evolution'
  isDefault: boolean
  /** Only set for channelType 'cloud_api', and only once the Meta call
   *  for this number succeeds — `error` explains why when it's null. */
  displayPhoneNumber: string | null
  verifiedName: string | null
  qualityRating: string | null
  status: string | null
  nameStatus: string | null
  codeVerificationStatus: string | null
  /** Portfolio-level since Meta's Oct 2025 change, still returned per
   *  number — see meta-api.ts's verifyPhoneNumber doc comment. */
  messagingLimitTier: string | null
  /** Set when the Meta call for THIS number failed — every other field
   *  above stays null so the UI can show "Indisponível: {error}"
   *  instead of a silent dash. */
  error: string | null
}

/**
 * Surfaces every connected WhatsApp number's quality/status for the
 * Reports → Qualidade tab — one entry per active whatsapp_channels row
 * (Cloud API numbers get a live Meta lookup each; Evolution numbers
 * are listed with no Meta data, since Evolution isn't on Meta's
 * platform at all). A dedicated route (rather than calling Meta from
 * the client) because the access token only ever gets decrypted
 * server-side, and this endpoint never echoes it back.
 *
 * Separate from /api/whatsapp/quality (singular channel, used by the
 * broadcast wizard's anti-ban badge) because that route's response
 * shape is a fixed contract for step4-schedule-send.tsx and the two
 * callers need genuinely different data (one number vs. every number).
 */
export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 },
    )
  }

  const { data: rows, error: channelsError } = await supabase
    .from('whatsapp_channels')
    .select('id, name, phone_number_id, access_token_encrypted, channel_type, is_default')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  if (channelsError) {
    return NextResponse.json({ error: channelsError.message }, { status: 500 })
  }

  const channels: ChannelQualityInfo[] = await Promise.all(
    (rows ?? []).map(async (row): Promise<ChannelQualityInfo> => {
      const base = {
        channelId: row.id as string,
        name: row.name as string,
        isDefault: row.is_default as boolean,
      }

      if (row.channel_type === 'evolution') {
        return {
          ...base,
          channelType: 'evolution',
          displayPhoneNumber: null,
          verifiedName: null,
          qualityRating: null,
          status: null,
          nameStatus: null,
          codeVerificationStatus: null,
          messagingLimitTier: null,
          error: null,
        }
      }

      try {
        const info = await verifyPhoneNumber({
          phoneNumberId: row.phone_number_id as string,
          accessToken: decrypt(row.access_token_encrypted as string),
        })
        return {
          ...base,
          channelType: 'cloud_api',
          displayPhoneNumber: info.display_phone_number ?? null,
          verifiedName: info.verified_name ?? null,
          qualityRating: info.quality_rating ?? null,
          status: info.status ?? null,
          nameStatus: info.name_status ?? null,
          codeVerificationStatus: info.code_verification_status ?? null,
          messagingLimitTier: info.whatsapp_business_manager_messaging_limit ?? null,
          error: null,
        }
      } catch (err) {
        return {
          ...base,
          channelType: 'cloud_api',
          displayPhoneNumber: null,
          verifiedName: null,
          qualityRating: null,
          status: null,
          nameStatus: null,
          codeVerificationStatus: null,
          messagingLimitTier: null,
          error: err instanceof Error ? err.message : 'Unknown error',
        }
      }
    }),
  )

  return NextResponse.json({ channels, checkedAt: new Date().toISOString() })
}
