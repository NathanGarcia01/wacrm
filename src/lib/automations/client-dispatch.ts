import type { AutomationTriggerType } from '@/types'

/**
 * Fire-and-forget automation dispatch for events whose mutation happens
 * client-side (deal stage/status changes, conversation status changes) —
 * those flows write straight to Supabase from the browser and have no
 * server-side hook of their own. Reuses the existing authenticated
 * manual-trigger endpoint (POST /api/automations/engine) instead of
 * adding new API routes. Never throws: an automation failure must not
 * block the UI action that triggered it.
 */
export function fireAutomationTrigger(
  triggerType: AutomationTriggerType,
  contactId: string | null | undefined,
  context?: Record<string, unknown>,
): void {
  if (!contactId) return
  fetch('/api/automations/engine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger_type: triggerType, contact_id: contactId, context: context ?? {} }),
  }).catch((err) => console.error(`[automations] failed to fire ${triggerType}:`, err))
}
