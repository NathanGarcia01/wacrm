import type { SupabaseClient } from '@supabase/supabase-js'
import { isWithinAccountBusinessHours } from '@/lib/attendance/business-hours'

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
/** Motivos que, sem dedup próprio, gerariam uma linha nova em
 *  followup_dispatch_log a cada varredura do cron enquanto a conversa
 *  seguir bloqueada — nenhum deles passa por executeAutomation/node de
 *  envio (que é de onde vem o dedup "1x por período" automático via
 *  automation_logs/flow_runs), nem por um evento pontual do webhook
 *  (como opted_out detectado via cancelPendingInactivityFollowups,
 *  que dispara 1x por mensagem inbound, não 1x por tick de cron).
 *  `opted_out` entra aqui especificamente pelo pré-check do CRON
 *  (inactivity-cron/route.ts) — o MESMO motivo logado por
 *  cancelPendingInactivityFollowups continua usando logFollowupDispatch
 *  normal, pois ali é um evento, não uma varredura repetida. */
export type DedupedFollowupSkipReason =
  | 'max_attempts_reached'
  | 'daily_cap_reached'
  | 'outside_business_hours'
  | 'opted_out'
export type FollowupSkipReason = DedupedFollowupSkipReason | 'outside_session_window' | 'customer_replied'

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

/**
 * Fase 2 (Follow-up seguro) — B2. Quantas tentativas (linhas
 * `outcome='sent'`) esta conversa já recebeu DESDE a última vez que o
 * cliente escreveu — `mode='dry_run'` nunca entra na conta (não é um
 * envio real), e tentativas de ANTES de `last_customer_message_at`
 * não contam: uma resposta do cliente reinicia o contador, já que
 * marca o início de um novo período de silêncio. `coalesce(...,
 * '-infinity')` cobre o caso raro de nunca ter ouvido o cliente —
 * nesse caso TODA tentativa histórica conta (não há "resposta" pra
 * reiniciar a contagem a partir de).
 */
export async function countFollowupAttemptsSinceLastReply(
  db: SupabaseClient,
  conversationId: string,
  lastCustomerMessageAt: string | null,
): Promise<number> {
  let query = db
    .from('followup_dispatch_log')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('outcome', 'sent')
    .eq('mode', 'live')
  if (lastCustomerMessageAt) {
    query = query.gt('created_at', lastCustomerMessageAt)
  }
  const { count, error } = await query
  if (error) {
    console.error('[inactivity-followup] countFollowupAttemptsSinceLastReply failed:', error)
    return 0
  }
  return count ?? 0
}

/**
 * O instante UTC correspondente à meia-noite LOCAL de `now` no fuso
 * `timezone` — ex.: now=2026-11-19T02:00:00Z, timezone=
 * 'America/Sao_Paulo' (UTC-3) → 2026-11-18T23:00:00-03:00 é meia-noite
 * local, que em UTC é 2026-11-19T02:00:00Z... na prática, calcula
 * quanto já passou do dia local (hh:mm:ss) e subtrai isso de `now`,
 * então o resultado não depende do fuso do SERVIDOR — só do fuso da
 * conta, que é o que importa pro teto diário reiniciar na hora certa.
 */
function startOfDayInTimezone(now: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const second = Number(parts.find((p) => p.type === 'second')?.value ?? '0')
  const msIntoLocalDay = ((hour * 60 + minute) * 60 + second) * 1000
  return new Date(now.getTime() - msIntoLocalDay)
}

/**
 * Fase 2 (Follow-up seguro) — B2. Quantos follow-ups de inatividade
 * (outcome='sent', mode='live') esta conta já disparou HOJE, no fuso
 * da própria conta — "hoje" precisa ser o dia local da conta, não
 * UTC, senão o teto reinicia na hora errada pra contas fora de
 * America/Sao_Paulo. `timezone` é passado pelo chamador (já resolvido
 * de `accounts.timezone`) em vez de buscado aqui de novo — quem
 * chama (triggerMatches) já faz essa busca pro check de horário
 * comercial quando `respect_business_hours` está ligado; quando não
 * está, o chamador resolve o timezone só pra isto.
 */
export async function countFollowupSentToday(
  db: SupabaseClient,
  accountId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<number> {
  const startOfToday = startOfDayInTimezone(now, timezone)
  const { count, error } = await db
    .from('followup_dispatch_log')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('outcome', 'sent')
    .eq('mode', 'live')
    .gte('created_at', startOfToday.toISOString())
  if (error) {
    console.error('[inactivity-followup] countFollowupSentToday failed:', error)
    return 0
  }
  return count ?? 0
}

export interface InactivityFollowupConfig {
  last_sender?: 'agent' | 'customer' | 'any'
  max_attempts?: number
  respect_business_hours?: boolean
}

export interface EvaluateInactivityFollowupGuardsArgs {
  accountId: string
  conversationId: string
  cfg: InactivityFollowupConfig
  lastCustomerMessageAt: string | null
  lastMessageSenderType: string | null
  now?: Date
}

export type InactivityFollowupGuardResult =
  | { fire: true }
  // `reason` fica undefined só no caso de last_sender não combinar —
  // ali não é "seria disparado mas foi bloqueado", é "esta
  // automation/flow não se aplica a esta conversa", então não gera
  // linha de auditoria (ver triggerMatches em engine.ts/
  // workflow-engine.ts, que só chama logFollowupDispatch quando
  // `reason` vem preenchido).
  | { fire: false; reason?: DedupedFollowupSkipReason }

/**
 * Fase 2 (Follow-up seguro) — B2. Único ponto de verdade pros 4 checks
 * novos de segurança do follow-up de inatividade — chamado de dentro
 * do `triggerMatches` de AMBOS os motores (engine.ts/
 * workflow-engine.ts), pela mesma razão de todo o resto deste módulo:
 * as regras precisam ser idênticas nos dois.
 *
 * Ordem deliberada: last_sender (sem banco) → horário comercial →
 * max_attempts → teto diário. Checar horário comercial antes dos
 * contadores evita 2 queries de contagem numa conversa que de
 * qualquer forma vai ser adiada.
 */
export async function evaluateInactivityFollowupGuards(
  db: SupabaseClient,
  args: EvaluateInactivityFollowupGuardsArgs,
): Promise<InactivityFollowupGuardResult> {
  const lastSender = args.cfg.last_sender ?? 'any'
  if (lastSender !== 'any') {
    const senderType = args.lastMessageSenderType
    const matches =
      lastSender === 'agent' ? senderType === 'agent' || senderType === 'bot' : senderType === 'customer'
    if (!matches) return { fire: false }
  }

  if (args.cfg.respect_business_hours) {
    const withinHours = await isWithinAccountBusinessHours(db, args.accountId, args.now)
    if (!withinHours) return { fire: false, reason: 'outside_business_hours' }
  }

  if (typeof args.cfg.max_attempts === 'number') {
    const attempts = await countFollowupAttemptsSinceLastReply(db, args.conversationId, args.lastCustomerMessageAt)
    if (attempts >= args.cfg.max_attempts) return { fire: false, reason: 'max_attempts_reached' }
  }

  const { data: account } = await db.from('accounts').select('timezone').eq('id', args.accountId).maybeSingle()
  const timezone = (account?.timezone as string | null) ?? 'America/Sao_Paulo'
  const { data: settings } = await db
    .from('followup_settings')
    .select('max_per_day')
    .eq('account_id', args.accountId)
    .maybeSingle()
  const maxPerDay = (settings?.max_per_day as number | undefined) ?? 50
  const sentToday = await countFollowupSentToday(db, args.accountId, timezone, args.now)
  if (sentToday >= maxPerDay) return { fire: false, reason: 'daily_cap_reached' }

  return { fire: true }
}

export interface LogFollowupSkipOncePerSilencePeriodArgs {
  accountId: string
  automationId?: string | null
  flowId?: string | null
  conversationId: string
  contactId: string
  reason: DedupedFollowupSkipReason
}

/**
 * Fase 2 (Follow-up seguro) — B2, correção. max_attempts_reached/
 * daily_cap_reached/outside_business_hours são decididos dentro de
 * `triggerMatches`, ANTES de executeAutomation/node de envio rodar —
 * ou seja, NUNCA escrevem em automation_logs/flow_runs, que é de onde
 * vem o dedup "só reavalia 1x por período de silêncio" que todo o
 * resto do fluxo ganha de graça. Sem isso, toda varredura do cron
 * (a cada poucos minutos, por horas/dias enquanto a conversa seguir
 * bloqueada) grava uma linha nova em followup_dispatch_log pra essa
 * conversa — 100 varreduras na mesma janela de silêncio geram 100
 * linhas, não 1.
 *
 * `silenceStartedAt` é a âncora do período atual — o mesmo
 * `conversations.last_message_at` que o cron já repassa em
 * `ctx.vars.last_message_at` (muda só quando QUALQUER lado manda uma
 * mensagem nova). Upsert com `ignoreDuplicates` contra o índice único
 * (conversation_id, reason, silence_started_at) da migration 138 —
 * não é um SELECT-antes-de-INSERT (que teria race entre ticks
 * sobrepostos); o 2º+ insert do mesmo período vira
 * `ON CONFLICT DO NOTHING` no banco, de forma atômica.
 */
export async function logFollowupSkipOncePerSilencePeriod(
  db: SupabaseClient,
  args: LogFollowupSkipOncePerSilencePeriodArgs,
  silenceStartedAt: string,
): Promise<void> {
  const { error } = await db
    .from('followup_dispatch_log')
    .upsert(
      {
        account_id: args.accountId,
        automation_id: args.automationId ?? null,
        flow_id: args.flowId ?? null,
        conversation_id: args.conversationId,
        contact_id: args.contactId,
        outcome: 'skipped',
        reason: args.reason,
        mode: 'live',
        silence_started_at: silenceStartedAt,
      },
      { onConflict: 'conversation_id,reason,silence_started_at', ignoreDuplicates: true },
    )
  if (error) {
    console.error('[inactivity-followup] logFollowupSkipOncePerSilencePeriod failed:', error)
  }
}
