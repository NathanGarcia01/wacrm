import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { runFlowsForTrigger } from '@/lib/flows/workflow-engine'
import type { InactivityTriggerConfig } from '@/types'

/**
 * Scans for conversations that have gone quiet past each account's
 * `inactivity` automations'/workflow-flows' configured threshold and
 * dispatches the trigger to both engines. Meant to be hit on the same
 * schedule as the other automation crons (external pinger) — same
 * shared-secret auth as /api/automations/cron and /api/nps/cron.
 *
 * The scan cutoff per account is the MINIMUM `hours` among that
 * account's active `inactivity` automations AND workflow-mode flows
 * combined, so a single pass covers every one of them (an account with
 * only a flow and no automations must still be scanned); each engine's
 * own triggerMatches() then filters against its own configured hours
 * (and dedupes repeat firings for the same quiet period) once
 * runAutomationsForTrigger/runFlowsForTrigger evaluates it — see
 * src/lib/automations/engine.ts and src/lib/flows/workflow-engine.ts.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  // Count of stale conversations evaluated, not of automations that
  // actually fired — runAutomationsForTrigger() is void and decides
  // per-automation matches (threshold + dedup) internally.
  let evaluated = 0

  const { data: automations, error } = await db
    .from('automations')
    .select('account_id, trigger_config')
    .eq('trigger_type', 'inactivity')
    .eq('is_active', true)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: workflowFlows, error: flowsError } = await db
    .from('flows')
    .select('account_id, trigger_config')
    .eq('trigger_type', 'inactivity')
    .eq('run_mode', 'workflow')
    .eq('status', 'active')

  if (flowsError) {
    return NextResponse.json({ error: flowsError.message }, { status: 500 })
  }

  const minHoursByAccount = new Map<string, number>()
  for (const a of [...(automations ?? []), ...(workflowFlows ?? [])]) {
    const hours = Number((a.trigger_config as InactivityTriggerConfig)?.hours) || 24
    const current = minHoursByAccount.get(a.account_id as string)
    if (current === undefined || hours < current) {
      minHoursByAccount.set(a.account_id as string, hours)
    }
  }

  for (const [accountId, minHours] of minHoursByAccount) {
    const cutoff = new Date(Date.now() - minHours * 60 * 60 * 1000).toISOString()
    const { data: staleConvs } = await db
      .from('conversations')
      .select('id, contact_id, last_message_at')
      .eq('account_id', accountId)
      .eq('status', 'open')
      .lt('last_message_at', cutoff)
      .not('last_message_at', 'is', null)
      .not('contact_id', 'is', null)
      .order('last_message_at', { ascending: true })
      .limit(100)

    for (const conv of staleConvs ?? []) {
      const lastMessageAt = conv.last_message_at as string
      const elapsedHours = (Date.now() - new Date(lastMessageAt).getTime()) / (60 * 60 * 1000)
      const dispatchInput = {
        accountId,
        triggerType: 'inactivity' as const,
        contactId: conv.contact_id as string,
        context: {
          conversation_id: conv.id as string,
          vars: { inactive_hours: elapsedHours, last_message_at: lastMessageAt },
        },
      }
      await runAutomationsForTrigger(dispatchInput)
      await runFlowsForTrigger(dispatchInput)
      evaluated++
    }
  }

  return NextResponse.json({ evaluated })
}
