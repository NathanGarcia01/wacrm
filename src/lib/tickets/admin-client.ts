import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the ticket lifecycle lib.
// Mirrors src/lib/automations/admin-client.ts / src/lib/flows/admin-client.ts
// — same shape so anyone reading any of the three picks up the convention
// immediately. Every ticket mutation goes through this client, never the
// RLS-scoped per-request one: the lifecycle lib is meant to be called from
// server contexts (webhook, send route, future cron) that already resolved
// and validated the account/actor themselves.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
