import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  evaluateInactivityFollowupGuards,
  isContactOptedOutForFollowup,
  logFollowupDispatch,
} from '@/lib/automations/inactivity-followup'
import { getAccountPlanFeatures } from '@/lib/billing/server'
import type { InactivityTriggerConfig } from '@/types'

const MAX_CONVERSATIONS_PER_ACCOUNT = 100

/**
 * Fase 2 (Follow-up seguro) — B3. Pré-visualização do que o follow-up
 * de inatividade FARIA — mesma varredura e as mesmas regras de
 * segurança de /api/automations/inactivity-cron (opt-out,
 * last_sender, max_attempts, teto diário, horário comercial, via
 * evaluateInactivityFollowupGuards — único ponto de verdade), mas:
 *
 *   1. NUNCA chama runAutomationsForTrigger/runFlowsForTrigger — não
 *      existe caminho de código daqui até engineSendText/
 *      engineSendTemplate. Um "sent" aqui significa só "passaria por
 *      todos os checks", nunca um envio real.
 *
 *   2. Toda linha grava com mode='dry_run' — nunca conta pra
 *      max_attempts/max_per_day (ver countFollowupAttemptsSinceLastReply/
 *      countFollowupSentToday, que filtram mode='live').
 *
 *   3. Grava com INSERT simples (logFollowupDispatch), nunca com o
 *      upsert deduplicado de logFollowupSkipOncePerSilencePeriod — essa
 *      função grava `silence_started_at` e colidiria no índice único
 *      da migration 138 (conversation_id, reason, silence_started_at)
 *      contra uma linha LIVE do mesmo período, apagando ou bloqueando
 *      o registro de produção. Dry-run deixa `silence_started_at`
 *      sempre null (nunca entra no índice), então repetir o dry-run
 *      manualmente várias vezes só acumula mais linhas dry_run — aceito
 *      de propósito, já que é um utilitário manual, não um cron
 *      recorrente.
 *
 *   4. NÃO toca `inactivity_scan_cursor` — usa a mesma ordenação
 *      (last_message_at ASC) mas sempre começa do zero, pra nunca
 *      interferir na paginação real do cron.
 *
 * Mesma auth do cron (x-cron-secret) — "rota protegida" + "utilitário
 * pra rodar manualmente" via curl, não agendada em lugar nenhum.
 * Aceita `?accountId=` opcional pra restringir a varredura a uma
 * única conta (ex.: só a conta de teste, antes de rodar em todas).
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

  const url = new URL(request.url)
  const onlyAccountId = url.searchParams.get('accountId')

  const db = supabaseAdmin()

  const { data: automations, error } = await db
    .from('automations')
    .select('id, account_id, trigger_config')
    .eq('trigger_type', 'inactivity')
    .eq('is_active', true)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: workflowFlows, error: flowsError } = await db
    .from('flows')
    .select('id, account_id, trigger_config')
    .eq('trigger_type', 'inactivity')
    .eq('run_mode', 'workflow')
    .eq('status', 'active')
  if (flowsError) {
    return NextResponse.json({ error: flowsError.message }, { status: 500 })
  }

  const minHoursByAccount = new Map<string, number>()
  for (const a of [...(automations ?? []), ...(workflowFlows ?? [])]) {
    if (onlyAccountId && a.account_id !== onlyAccountId) continue
    const hours = Number((a.trigger_config as InactivityTriggerConfig)?.hours) || 24
    const current = minHoursByAccount.get(a.account_id as string)
    if (current === undefined || hours < current) {
      minHoursByAccount.set(a.account_id as string, hours)
    }
  }

  let evaluated = 0
  let wouldSend = 0
  let skippedPlan = 0
  const bySkipReason: Record<string, number> = {}

  function bumpReason(reason: string) {
    bySkipReason[reason] = (bySkipReason[reason] ?? 0) + 1
  }

  for (const [accountId, minHours] of minHoursByAccount) {
    const features = await getAccountPlanFeatures(db, accountId)
    if (!features.hasFollowup) {
      skippedPlan++
      continue
    }

    const cutoff = new Date(Date.now() - minHours * 60 * 60 * 1000).toISOString()
    const { data: staleConvs } = await db
      .from('conversations')
      .select('id, contact_id, last_message_at, last_customer_message_at, last_message_sender_type')
      .eq('account_id', accountId)
      .eq('status', 'open')
      .lt('last_message_at', cutoff)
      .not('last_message_at', 'is', null)
      .not('contact_id', 'is', null)
      .order('last_message_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(MAX_CONVERSATIONS_PER_ACCOUNT)

    const accountAutomations = (automations ?? []).filter((a) => a.account_id === accountId)
    const accountFlows = (workflowFlows ?? []).filter((f) => f.account_id === accountId)

    for (const conv of staleConvs ?? []) {
      const conversationId = conv.id as string
      const contactId = conv.contact_id as string
      const lastMessageAt = conv.last_message_at as string
      const lastCustomerMessageAt = conv.last_customer_message_at as string | null
      const lastMessageSenderType = conv.last_message_sender_type as string | null
      const elapsedHours = (Date.now() - new Date(lastMessageAt).getTime()) / (60 * 60 * 1000)

      if (await isContactOptedOutForFollowup(db, accountId, contactId)) {
        evaluated++
        bumpReason('opted_out')
        await logFollowupDispatch(db, {
          accountId,
          conversationId,
          contactId,
          outcome: 'skipped',
          reason: 'opted_out',
          mode: 'dry_run',
        })
        continue
      }

      for (const automation of accountAutomations) {
        const cfg = (automation.trigger_config as InactivityTriggerConfig) ?? {}
        const hoursCfg = Number(cfg.hours) || 24
        if (elapsedHours < hoursCfg) continue
        evaluated++
        const guard = await evaluateInactivityFollowupGuards(db, {
          accountId,
          conversationId,
          cfg,
          lastCustomerMessageAt,
          lastMessageSenderType,
        })
        if (guard.fire) {
          wouldSend++
          await logFollowupDispatch(db, {
            accountId,
            automationId: automation.id,
            conversationId,
            contactId,
            outcome: 'sent',
            mode: 'dry_run',
          })
        } else if (guard.reason) {
          bumpReason(guard.reason)
          await logFollowupDispatch(db, {
            accountId,
            automationId: automation.id,
            conversationId,
            contactId,
            outcome: 'skipped',
            reason: guard.reason,
            mode: 'dry_run',
          })
        }
      }

      for (const flow of accountFlows) {
        const cfg = (flow.trigger_config as InactivityTriggerConfig) ?? {}
        const hoursCfg = Number(cfg.hours) || 24
        if (elapsedHours < hoursCfg) continue
        evaluated++
        const guard = await evaluateInactivityFollowupGuards(db, {
          accountId,
          conversationId,
          cfg,
          lastCustomerMessageAt,
          lastMessageSenderType,
        })
        if (guard.fire) {
          wouldSend++
          await logFollowupDispatch(db, {
            accountId,
            flowId: flow.id,
            conversationId,
            contactId,
            outcome: 'sent',
            mode: 'dry_run',
          })
        } else if (guard.reason) {
          bumpReason(guard.reason)
          await logFollowupDispatch(db, {
            accountId,
            flowId: flow.id,
            conversationId,
            contactId,
            outcome: 'skipped',
            reason: guard.reason,
            mode: 'dry_run',
          })
        }
      }
    }
  }

  return NextResponse.json({ evaluated, wouldSend, skippedPlan, bySkipReason })
}
