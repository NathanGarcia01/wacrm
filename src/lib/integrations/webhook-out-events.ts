// Client-safe constants shared between the settings UI and the server-side
// dispatch logic (src/lib/integrations/webhook-out.ts). Kept in its own
// file — importing the dispatch module directly from client components
// would pull `node:dns/promises` and the service-role Supabase client into
// the browser bundle.

export const WEBHOOK_OUT_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGE_SENT',
  'CONVERSATION_CREATED',
  'CONTACT_CREATED',
  'DEAL_CREATED',
  'DEAL_WON',
  'DEAL_LOST',
] as const

export type WebhookOutEvent = (typeof WEBHOOK_OUT_EVENTS)[number]

export function isWebhookOutEvent(value: unknown): value is WebhookOutEvent {
  return (
    typeof value === 'string' &&
    (WEBHOOK_OUT_EVENTS as readonly string[]).includes(value)
  )
}
