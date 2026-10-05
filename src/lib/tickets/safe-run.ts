import { ticketsEnabled } from './flags'

/**
 * Every ticket-lifecycle call site (webhook, evolution-webhook, send
 * route, conversation assign/close routes, automations engine, both
 * flow engines) wraps its ticket side effect in this — never calls
 * openTicketIfNeeded/recordAgentReply/assignTicket/etc. directly.
 *
 * Two guarantees, both required by Fase 1 Etapa 4's safety rules:
 *   - No-ops entirely when TICKETS_ENABLED isn't "true".
 *   - Never throws — a ticket-side failure must not break the primary
 *     action (saving a message, assigning a conversation, finishing an
 *     automation step) it's attached to. Logs and swallows instead.
 */
export async function runTicketSideEffect(label: string, fn: () => Promise<void>): Promise<void> {
  if (!ticketsEnabled()) return
  try {
    await fn()
  } catch (err) {
    console.error(`[tickets] ${label} failed:`, err)
  }
}
