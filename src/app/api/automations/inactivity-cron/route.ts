import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { runFlowsForTrigger } from '@/lib/flows/workflow-engine'
import { isContactOptedOutForFollowup, logFollowupDispatch } from '@/lib/automations/inactivity-followup'
import { getAccountPlanFeatures } from '@/lib/billing/server'
import type { InactivityTriggerConfig } from '@/types'

const MAX_CONVERSATIONS_PER_ACCOUNT_PER_TICK = 100

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
 *
 * Fase 2 (Follow-up seguro) — B1, três mudanças:
 *
 *   1. Gate de plano: contas sem `hasFollowup` (Starter, não interna)
 *      são puladas aqui — nem entram na varredura. is_internal já
 *      cai em "business" via getAccountPlanFeatures.
 *
 *   2. Opt-out: checado por conversa, ANTES de chamar qualquer
 *      engine — nunca dispara pra contato opted-out, nem deixa a
 *      decisão pra dentro de uma automation/flow específica (essa
 *      camada existe TAMBÉM dentro do send_message/send_template de
 *      cada engine, pro caso de opt-out acontecer DURANTE um `wait`
 *      step/node — ver inactivity-followup.ts).
 *
 *   3. Cursor de paginação por keyset (last_message_at, id) via
 *      inactivity_scan_cursor — antes, `limit(100)` sempre pegava as
 *      MESMAS 100 conversas mais antigas em todo tick (dedup evita
 *      reenvio, mas nunca tirava a conversa da varredura), então uma
 *      conta com >100 conversas paradas nunca via a 101ª. Agora cada
 *      tick continua de onde o anterior parou; quando uma página volta
 *      com menos que o limite, o cursor reseta pro início — garante
 *      ciclar por TODA conversa parada em `ceil(total/100)` ticks.
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

  // Whole-route lock (migration 115) — the per-trigger dedup below is a
  // check-then-act SELECT against automation_logs/flow_runs, which races
  // under an overlapping invocation (slow previous tick + a new one
  // firing on schedule): both could pass the dedup check before either
  // writes its log/run row, double-dispatching the automation/flow. TTL
  // matches the 5-minute schedule this route is meant to run on.
  const { data: acquired, error: lockError } = await db.rpc('try_acquire_cron_lock', {
    p_job_name: 'automations-inactivity-cron',
    p_ttl_seconds: 240,
  })
  if (lockError) {
    return NextResponse.json({ error: lockError.message }, { status: 500 })
  }
  if (!acquired) {
    return NextResponse.json({ skipped: true, reason: 'locked' })
  }

  // Count of stale conversations evaluated, not of automations that
  // actually fired — runAutomationsForTrigger() is void and decides
  // per-automation matches (threshold + dedup) internally.
  let evaluated = 0
  let skippedOptedOut = 0
  let skippedPlan = 0

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
    const features = await getAccountPlanFeatures(db, accountId)
    if (!features.hasFollowup) {
      skippedPlan++
      continue
    }

    const { data: cursor } = await db
      .from('inactivity_scan_cursor')
      .select('last_seen_last_message_at, last_seen_conversation_id')
      .eq('account_id', accountId)
      .maybeSingle()

    const cutoff = new Date(Date.now() - minHours * 60 * 60 * 1000).toISOString()
    let query = db
      .from('conversations')
      .select('id, contact_id, last_message_at')
      .eq('account_id', accountId)
      .eq('status', 'open')
      .lt('last_message_at', cutoff)
      .not('last_message_at', 'is', null)
      .not('contact_id', 'is', null)

    if (cursor?.last_seen_last_message_at) {
      // Keyset pagination — "rows strictly after (last_message_at, id)
      // in ORDER BY last_message_at, id" — PostgREST's .or() with a
      // nested and() is the documented way to express a tuple
      // comparison without raw SQL.
      query = query.or(
        `last_message_at.gt.${cursor.last_seen_last_message_at},` +
          `and(last_message_at.eq.${cursor.last_seen_last_message_at},id.gt.${cursor.last_seen_conversation_id})`,
      )
    }

    const { data: staleConvs } = await query
      .order('last_message_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(MAX_CONVERSATIONS_PER_ACCOUNT_PER_TICK)

    const rows = staleConvs ?? []
    for (const conv of rows) {
      const conversationId = conv.id as string
      const contactId = conv.contact_id as string
      const lastMessageAt = conv.last_message_at as string

      if (await isContactOptedOutForFollowup(db, accountId, contactId)) {
        skippedOptedOut++
        evaluated++
        await logFollowupDispatch(db, {
          accountId,
          conversationId,
          contactId,
          outcome: 'skipped',
          reason: 'opted_out',
        })
        continue
      }

      const elapsedHours = (Date.now() - new Date(lastMessageAt).getTime()) / (60 * 60 * 1000)
      const dispatchInput = {
        accountId,
        triggerType: 'inactivity' as const,
        contactId,
        context: {
          conversation_id: conversationId,
          vars: { inactive_hours: elapsedHours, last_message_at: lastMessageAt },
        },
      }
      await runAutomationsForTrigger(dispatchInput)
      await runFlowsForTrigger(dispatchInput)
      evaluated++
    }

    // Menos que o limite = chegou ao fim do conjunto parado desta
    // conta nesta passada — reseta pro início; senão, avança o
    // cursor pra última linha vista.
    const lastRow = rows[rows.length - 1]
    await db.from('inactivity_scan_cursor').upsert({
      account_id: accountId,
      last_seen_last_message_at: rows.length < MAX_CONVERSATIONS_PER_ACCOUNT_PER_TICK ? null : lastRow.last_message_at,
      last_seen_conversation_id: rows.length < MAX_CONVERSATIONS_PER_ACCOUNT_PER_TICK ? null : lastRow.id,
      updated_at: new Date().toISOString(),
    })
  }

  return NextResponse.json({ evaluated, skippedOptedOut, skippedPlan })
}
