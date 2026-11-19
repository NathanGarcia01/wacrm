import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Fase 2 (Follow-up seguro) — Etapa B, B1. Peças compartilhadas entre
 * automations (engine.ts) e flows (workflow-engine.ts) para o
 * gatilho `inactivity` — nenhuma das duas depende da outra, mas as
 * regras de segurança (opt-out, cancelamento durante espera,
 * auditoria) precisam ser IDÊNTICAS nos dois motores, daí viverem
 * aqui em vez de duplicadas.
 *
 * Toma `db: SupabaseClient` como parâmetro em vez de importar um
 * admin client próprio — mesma convenção de opt-out-handler.ts/
 * blocked-phones.ts: quem chama (engine.ts, workflow-engine.ts, a
 * rota de cron, o webhook) já tem o client certo em mãos, e isso
 * mantém o módulo testável com um mock simples, sem depender de env
 * vars de service role nos testes.
 */

export type FollowupOutcome = 'sent' | 'skipped'
export type FollowupSkipReason =
  | 'opted_out'
  | 'outside_session_window'
  | 'customer_replied'
  | 'max_attempts_reached'
  | 'daily_cap_reached'
  | 'outside_business_hours'

export interface LogFollowupDispatchArgs {
  accountId: string
  /** Exatamente um dos dois, ou os dois null (ex.: opt-out detectado
   *  antes de saber qual automation/flow dispararia — ver o CHECK da
   *  migration 137). */
  automationId?: string | null
  flowId?: string | null
  conversationId: string
  contactId: string
  outcome: FollowupOutcome
  reason?: FollowupSkipReason | null
  /** 'dry_run' nunca conta pra max_attempts/max_per_day (B2) — só
   *  existe pra relatório manual (B3). Default 'live'. */
  mode?: 'live' | 'dry_run'
}

/**
 * Único ponto de escrita em `followup_dispatch_log`. "Tentativa" =
 * UMA linha com outcome='sent' por DISPARO do follow-up (quando a
 * automation/flow começa a executar), nunca por passo de envio
 * dentro dela — uma automation com dois `send_message` steps ainda
 * conta como 1 tentativa. Chamado no loop de
 * runAutomationsForTrigger/runFlowsForTrigger (engine.ts/
 * workflow-engine.ts) e nos pontos de skip (cron, send steps,
 * cancelamento por resposta/opt-out durante espera).
 */
export async function logFollowupDispatch(db: SupabaseClient, args: LogFollowupDispatchArgs): Promise<void> {
  const { error } = await db.from('followup_dispatch_log').insert({
    account_id: args.accountId,
    automation_id: args.automationId ?? null,
    flow_id: args.flowId ?? null,
    conversation_id: args.conversationId,
    contact_id: args.contactId,
    outcome: args.outcome,
    reason: args.reason ?? null,
    mode: args.mode ?? 'live',
  })
  // Best-effort — mesma convenção de toda auditoria desta base
  // (ticket_events, routing_assignment_events): uma falha ao logar
  // nunca deve impedir a decisão real (enviar ou não) que já foi
  // tomada antes desta chamada.
  if (error) {
    console.error('[inactivity-followup] logFollowupDispatch failed:', error)
  }
}

/**
 * Wrapper fino sobre a RPC `is_contact_opted_out` (migration
 * 133/135 — hoje só consulta blocked_phones). Único ponto de verdade
 * de opt-out em todo o caminho de follow-up — Radar usa a mesma RPC.
 */
export async function isContactOptedOutForFollowup(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  const { data, error } = await db.rpc('is_contact_opted_out', {
    p_account_id: accountId,
    p_contact_id: contactId,
  })
  if (error) {
    console.error('[inactivity-followup] is_contact_opted_out failed:', error)
    // Fail closed do lado de NUNCA mandar: se não dá pra confirmar
    // que o contato está liberado, trata como opted-out. O inverso
    // (fail open) arriscaria mandar pra alguém que pediu pra sair.
    return true
  }
  return !!data
}

export interface CancelPendingInactivityFollowupsArgs {
  accountId: string
  contactId: string
}

export interface CancelPendingInactivityFollowupsResult {
  automationsCancelled: number
  flowsCancelled: number
}

/**
 * O gap real que motivou este módulo: hoje, se o cliente responde OU
 * entra em opt-out enquanto uma automation/flow de INATIVIDADE está
 * parada num `wait` step/node, nada cancela essa espera —
 * resumePendingExecution (automations/cron) e
 * resumePendingWorkflowExecution (flows/pending-cron) despachariam o
 * passo seguinte (ex. send_message) ignorando que a conversa mudou
 * de estado. Confirmado lendo o webhook por completo: ele nunca toca
 * `automation_pending_executions`/`flow_pending_executions`.
 *
 * Escopo deliberadamente restrito a automations/flows com
 * `trigger_type = 'inactivity'` — um `wait` de uma automation
 * disparada por keyword/tag/etc. tem semântica diferente (ex.: "espera
 * 1 dia e manda lembrete" não deveria cancelar só porque o cliente
 * mandou outra mensagem no meio) e está fora do que foi pedido aqui.
 *
 * Chamado de dois lugares no webhook: (1) depois de QUALQUER mensagem
 * inbound do cliente (texto, botão, mídia — qualquer uma significa
 * "não está mais em silêncio"), reason='customer_replied'; (2) nos
 * dois pontos de opt-out automático existentes (erro 131050, toggle
 * "stop" da Meta), reason='opted_out'. O opt-out via botão SAIR/NÃO
 * SOU A PESSOA já cai no caso (1) — é estruturalmente uma mensagem
 * inbound, não precisa de um terceiro ponto de chamada.
 *
 * Os dois crons de resume (`/api/automations/cron`,
 * `/api/flows/pending-cron`) já filtram `WHERE status='pending'` —
 * uma linha 'cancelled' simplesmente para de aparecer pra eles, sem
 * precisar mudar mais nada ali.
 */
export async function cancelPendingInactivityFollowups(
  db: SupabaseClient,
  args: CancelPendingInactivityFollowupsArgs,
  reason: 'customer_replied' | 'opted_out',
): Promise<CancelPendingInactivityFollowupsResult> {
  const [{ data: inactivityAutomations }, { data: inactivityFlows }] = await Promise.all([
    db.from('automations').select('id').eq('account_id', args.accountId).eq('trigger_type', 'inactivity'),
    db.from('flows').select('id').eq('account_id', args.accountId).eq('trigger_type', 'inactivity'),
  ])
  const automationIds = ((inactivityAutomations ?? []) as { id: string }[]).map((a) => a.id)
  const flowIds = ((inactivityFlows ?? []) as { id: string }[]).map((f) => f.id)

  let automationsCancelled = 0
  let flowsCancelled = 0

  if (automationIds.length > 0) {
    const { data: cancelled, error } = await db
      .from('automation_pending_executions')
      .update({ status: 'cancelled' })
      .eq('contact_id', args.contactId)
      .eq('status', 'pending')
      .in('automation_id', automationIds)
      .select('id')
    if (error) {
      console.error('[inactivity-followup] cancel automation_pending_executions failed:', error)
    } else {
      automationsCancelled = cancelled?.length ?? 0
    }
  }

  if (flowIds.length > 0) {
    const { data: cancelled, error } = await db
      .from('flow_pending_executions')
      .update({ status: 'cancelled' })
      .eq('contact_id', args.contactId)
      .eq('status', 'pending')
      .in('flow_id', flowIds)
      .select('id')
    if (error) {
      console.error('[inactivity-followup] cancel flow_pending_executions failed:', error)
    } else {
      flowsCancelled = cancelled?.length ?? 0
    }
  }

  if (automationsCancelled > 0 || flowsCancelled > 0) {
    const { data: conversation } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', args.accountId)
      .eq('contact_id', args.contactId)
      .maybeSingle()
    if (conversation) {
      await logFollowupDispatch(db, {
        accountId: args.accountId,
        conversationId: conversation.id as string,
        contactId: args.contactId,
        outcome: 'skipped',
        reason,
      })
    }
  }

  return { automationsCancelled, flowsCancelled }
}
