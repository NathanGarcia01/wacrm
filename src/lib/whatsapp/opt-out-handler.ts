import type { SupabaseClient } from '@supabase/supabase-js'
import {
  matchesExactKeyword,
  matchesReactivationKeyword,
  matchesWrongPersonButton,
  normalizeOptOutText,
  DEFAULT_OPT_OUT_CONFIRMATION_TEXT,
  DEFAULT_OPT_OUT_REACTIVATION_TEXT,
  WRONG_PERSON_BUTTON_LABEL,
} from './opt-out'
import { blockPhone, unblockPhone } from './blocked-phones'

export interface OptOutHandlerArgs {
  accountId: string
  contactId: string
  senderPhone: string
  text: string
}

/**
 * Fase 5, Etapa 1 — marketing opt-out keyword check + VOLTAR
 * reactivation on an inbound text message. Extracted out of the
 * webhook route (which has no other unit tests) specifically so this
 * logic is testable with a mocked Supabase client.
 *
 * `sendReply` is injected rather than calling engineSendText
 * directly, so a test can assert whether/what was sent without a
 * real WhatsApp send.
 */
export async function handleOptOutKeywords(
  db: SupabaseClient,
  args: OptOutHandlerArgs,
  sendReply: (text: string) => Promise<void>,
): Promise<void> {
  // Correção (pós Etapa 1) — uma resposta a um flow parado num
  // wait_for_reply (migration 061, flow_runs.status='waiting_reply')
  // pertence ao flow, não ao opt-out: "sair" pode ser uma resposta de
  // menu, não um pedido de bloqueio. Em erro na checagem, trata como
  // SE estivesse esperando (fail-closed pro lado de nunca bloquear
  // por engano uma resposta de fluxo) e não avalia a palavra-chave.
  const { data: waitingRun, error: flowErr } = await db
    .from('flow_runs')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('status', 'waiting_reply')
    .limit(1)
    .maybeSingle()
  if (flowErr || waitingRun) return

  const { data: account } = await db
    .from('accounts')
    .select('broadcast_optout_keywords, broadcast_optout_enforced')
    .eq('id', args.accountId)
    .maybeSingle()
  const keywords = (account?.broadcast_optout_keywords as string[] | null) ?? []
  const enforced = (account?.broadcast_optout_enforced as boolean | null) ?? false

  if (keywords.length > 0 && matchesExactKeyword(args.text, keywords)) {
    await blockPhone(db, args.accountId, args.senderPhone, 'keyword', `keyword:${normalizeOptOutText(args.text)}`)
    // Correção (pós Etapa 1) — sem accounts.broadcast_optout_enforced,
    // a captura é silenciosa: mandar "você não vai mais receber" seria
    // falso enquanto nada está de fato filtrando disparo pra essa conta.
    if (enforced) await sendReply(DEFAULT_OPT_OUT_CONFIRMATION_TEXT)
    return
  }

  if (matchesReactivationKeyword(args.text)) {
    await unblockPhone(
      db,
      args.accountId,
      args.senderPhone,
      ['keyword', 'cloud_api_error', 'meta_stop_promotions'],
      'keyword:voltar',
    )
    if (enforced) await sendReply(DEFAULT_OPT_OUT_REACTIVATION_TEXT)
  }
}

export interface OptOutButtonHandlerArgs {
  accountId: string
  contactId: string
  senderPhone: string
  buttonText: string
  /** Meta always sends one, but templates vary — a quick-reply button's
   *  payload can differ from its display text (e.g. configured with a
   *  stable id). Checked as a second candidate for both the keyword and
   *  the wrong-person match, never used alone. */
  buttonPayload: string
}

/**
 * Fase 2 (Radar) — correção: a Quick Reply "SAIR" ou "NÃO SOU A
 * PESSOA" num template nunca passava por aqui — só mensagem de texto
 * livre chamava handleOptOutKeywords. Em produção: blocked_phones com
 * 0 linhas contra 499 contatos que clicaram um desses dois botões, 30
 * deles já receberam outro disparo depois do clique.
 *
 * "SAIR" (e qualquer keyword customizada que a conta tenha
 * configurado em broadcast_optout_keywords) usa a MESMA lista
 * configurável de texto livre — se bater, é o mesmo bloqueio, mesma
 * reason (prefixo `button:` em vez de `keyword:` só pra distinguir a
 * origem no histórico). "NÃO SOU A PESSOA" fica fora dessa lista de
 * propósito — não é uma keyword de marketing, é "vocês mandaram pra
 * pessoa errada", então bloqueia incondicionalmente em toda conta,
 * independente de qualquer configuração.
 *
 * Sem a guarda de flow_runs.waiting_reply que handleOptOutKeywords
 * tem acima: aquele guard existe pra não confundir uma resposta de
 * MENU DE FLOW com opt-out, mas um flow responde via
 * message.interactive (button_reply/list_reply) — nunca via
 * message.type === 'button' (exclusivo de clique em Quick Reply de
 * TEMPLATE, ver o comentário do tipo em webhook/route.ts). Não tem
 * como colidir.
 */
export async function handleOptOutButtonTap(
  db: SupabaseClient,
  args: OptOutButtonHandlerArgs,
  sendReply: (text: string) => Promise<void>,
): Promise<void> {
  const candidates = [args.buttonText, args.buttonPayload]

  if (matchesWrongPersonButton(candidates)) {
    await blockPhone(db, args.accountId, args.senderPhone, 'keyword', `button:${WRONG_PERSON_BUTTON_LABEL}`)
    return
  }

  const { data: account } = await db
    .from('accounts')
    .select('broadcast_optout_keywords, broadcast_optout_enforced')
    .eq('id', args.accountId)
    .maybeSingle()
  const keywords = (account?.broadcast_optout_keywords as string[] | null) ?? []
  const enforced = (account?.broadcast_optout_enforced as boolean | null) ?? false
  if (keywords.length === 0) return

  const matched = candidates.find((c) => c != null && matchesExactKeyword(c, keywords))
  if (matched !== undefined) {
    await blockPhone(db, args.accountId, args.senderPhone, 'keyword', `button:${normalizeOptOutText(matched)}`)
    if (enforced) await sendReply(DEFAULT_OPT_OUT_CONFIRMATION_TEXT)
  }
}
