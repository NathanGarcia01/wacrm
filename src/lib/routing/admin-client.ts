import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the routing cycle. Mirrors
// src/lib/tickets/admin-client.ts / src/lib/automations/admin-client.ts
// — same per-domain copy convention. The routing cycle (cron-driven,
// no signed-in user) and the settings routes (already role-checked
// by requireRole before reaching here) are the only callers.
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
