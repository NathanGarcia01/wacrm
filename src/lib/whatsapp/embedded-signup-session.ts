/**
 * Server-side store for the ~10-minute window between the Embedded
 * Signup OAuth callback and the user picking a phone number on
 * /whatsapp-connect. See supabase/migrations/066 for the rationale
 * (why this can't just live in the URL or a cookie).
 *
 * whatsapp_embedded_signup_sessions has RLS enabled with zero
 * policies, so this always goes through a service-role client —
 * never the RLS-scoped client from requireRole().
 */

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from './encryption'
import type { EmbeddedSignupWaba } from './embedded-signup'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

export interface EmbeddedSignupSession {
  id: string
  accountId: string
  longLivedToken: string
  wabas: EmbeddedSignupWaba[]
  expiresAt: string
}

export async function createEmbeddedSignupSession(args: {
  accountId: string
  longLivedToken: string
  wabas: EmbeddedSignupWaba[]
}): Promise<string> {
  const { accountId, longLivedToken, wabas } = args

  // Best-effort cleanup of stale rows — cheap self-cleaning since this
  // table has no cron job of its own.
  await supabaseAdmin()
    .from('whatsapp_embedded_signup_sessions')
    .delete()
    .lt('expires_at', new Date().toISOString())

  const { data, error } = await supabaseAdmin()
    .from('whatsapp_embedded_signup_sessions')
    .insert({
      account_id: accountId,
      long_lived_token_encrypted: encrypt(longLivedToken),
      wabas,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[embedded-signup-session] create failed:', error)
    throw new Error('Failed to create embedded signup session')
  }
  return data.id
}

export async function getEmbeddedSignupSession(id: string): Promise<EmbeddedSignupSession | null> {
  const { data, error } = await supabaseAdmin()
    .from('whatsapp_embedded_signup_sessions')
    .select('id, account_id, long_lived_token_encrypted, wabas, expires_at')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[embedded-signup-session] fetch failed:', error)
    return null
  }
  if (!data) return null
  if (new Date(data.expires_at).getTime() < Date.now()) return null

  return {
    id: data.id,
    accountId: data.account_id,
    longLivedToken: decrypt(data.long_lived_token_encrypted),
    wabas: data.wabas as EmbeddedSignupWaba[],
    expiresAt: data.expires_at,
  }
}

export async function deleteEmbeddedSignupSession(id: string): Promise<void> {
  await supabaseAdmin().from('whatsapp_embedded_signup_sessions').delete().eq('id', id)
}
