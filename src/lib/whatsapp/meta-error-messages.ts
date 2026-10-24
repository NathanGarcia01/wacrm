/**
 * Meta WhatsApp Cloud API error codes, translated to PT-BR for display
 * in the broadcast recipients list (CLAUDE.md: "UI: português PT-BR
 * obrigatório"). `broadcast_recipients.error_message` stores Meta's
 * raw string verbatim (e.g. "(#131008) Required parameter is
 * missing") so the original is never lost — this module only affects
 * how it's *displayed*.
 *
 * Codes sourced from errors actually seen in this codebase (see
 * phone-utils.ts's 131030 check, webhook's 131050 check, the cron's
 * 130429 rate-limit check) plus Meta's published Cloud API error
 * reference for the other common send-time failures.
 */

export const META_ERROR_MESSAGES: Record<number, string> = {
  130429: 'Limite de envio da Meta atingido (rate limit) — tentaremos novamente mais tarde.',
  131000: 'Erro genérico da Meta ao enviar a mensagem.',
  131008: 'Faltou preencher uma variável do template.',
  131009: 'Parâmetro inválido enviado para a Meta.',
  131021: 'Remetente e destinatário são o mesmo número, ou destinatário duplicado.',
  131026: 'Não foi possível entregar a mensagem — número sem WhatsApp ou inacessível.',
  131030: 'Número do destinatário não está na lista de testes permitida (modo de desenvolvimento).',
  131031: 'Conta do WhatsApp Business foi restringida ou desativada pela Meta.',
  131042: 'Problema no método de pagamento da conta Meta — envios de template bloqueados.',
  131047: 'Mensagem fora da janela de 24h e sem template válido para reabrir a conversa.',
  131049: 'Mensagem não entregue por política de limite de spam da Meta.',
  131050: 'Destinatário optou por não receber mensagens de marketing (opt-out).',
  131051: 'Tipo de mensagem não suportado pelo destinatário.',
  131056: 'Limite de mensagens entre sua empresa e esse número atingido nas últimas 24h.',
  130472: 'Mensagem enviada por um experimento interno da Meta (teste A/B de número) — não é uma falha de envio.',
  132000: 'Parâmetros do template não correspondem ao template aprovado.',
  132001: 'Template não encontrado nessa tradução/idioma.',
  132005: 'O template usado está pausado ou foi desabilitado pela Meta.',
  132007: 'Conteúdo do template não corresponde ao que foi aprovado pela Meta.',
  132012: 'Parâmetro de botão inválido ou ausente no envio.',
  132015: 'Template reprovado pela Meta — revise o conteúdo em Configurações → Modelos.',
  133004: 'Servidor da Meta temporariamente indisponível — tentaremos novamente.',
  133005: 'PIN de verificação em duas etapas incorreto ou ausente.',
  133010: 'Número de telefone não está registrado na Cloud API.',
  2: 'Serviço da Meta temporariamente indisponível.',
};

/** Extracts the numeric code from Meta's own `"(#131008) ..."` message shape. */
export function parseMetaErrorCode(message: string | null | undefined): number | null {
  if (!message) return null;
  const match = message.match(/\(#(\d+)\)/);
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : null;
}

/**
 * Translates a Meta error to PT-BR for display. Prefers the explicit
 * `code` column (migration 114); falls back to parsing it out of the
 * raw message for older rows that predate that column. Unmapped codes
 * (or no code at all — e.g. the cron's own internal messages like
 * "Invalid phone number format") fall back to the raw message as-is.
 */
export function translateMetaError(
  message: string | null | undefined,
  code?: number | null,
): string {
  const resolvedCode = code ?? parseMetaErrorCode(message);
  if (resolvedCode != null && META_ERROR_MESSAGES[resolvedCode]) {
    return META_ERROR_MESSAGES[resolvedCode];
  }
  return message ?? '';
}
