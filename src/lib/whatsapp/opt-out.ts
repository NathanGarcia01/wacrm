/**
 * Marketing opt-out keyword matching (Fase 5, Etapa 1).
 *
 * Matching is ALWAYS against the whole normalized message, never a
 * substring — "consigo sair do banco?" must not match the keyword
 * "sair". Normalization: lowercase, strip diacritics, strip
 * whitespace/punctuation only from the two ends (internal content is
 * untouched, so a multi-word customer reply correctly stays long and
 * never collapses onto a single-word keyword).
 */
export function normalizeOptOutText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
}

export function matchesExactKeyword(messageText: string, keywords: string[]): boolean {
  const normalizedMessage = normalizeOptOutText(messageText)
  if (!normalizedMessage) return false
  return keywords.some((keyword) => normalizeOptOutText(keyword) === normalizedMessage)
}

/** Single, non-configurable reactivation keyword — "implementar o
 *  VOLTAR" from the Fase 5 plan. Same whole-message matching rule. */
export const REACTIVATION_KEYWORD = 'voltar'

export function matchesReactivationKeyword(messageText: string): boolean {
  return normalizeOptOutText(messageText) === REACTIVATION_KEYWORD
}

/**
 * Fase 2 (Radar) — correção: template quick-reply button whose label
 * means "you've got the wrong person" (Meta sends it as
 * `message.type === 'button'`, never as free text). Deliberately NOT
 * part of `accounts.broadcast_optout_keywords` — that list is for
 * "stop sending marketing" words a customer might type; this is a
 * different, stronger signal ("this isn't even the right person"),
 * so it blocks unconditionally in every account rather than being
 * configurable away.
 */
export const WRONG_PERSON_BUTTON_LABEL = 'nao sou a pessoa'

/**
 * Checks every candidate (button text, and its payload if Meta sends
 * a different one for this template) against the wrong-person label,
 * same whole-string/normalized matching rule as every other opt-out
 * check here.
 */
export function matchesWrongPersonButton(candidates: Array<string | null | undefined>): boolean {
  return candidates.some((c) => c != null && normalizeOptOutText(c) === WRONG_PERSON_BUTTON_LABEL)
}

/** Hardcoded PT-BR defaults — same pattern as
 *  DEFAULT_FOLLOW_UP_MESSAGE in src/lib/nps/webhook-handler.ts.
 *  Account-level override is a later Etapa (Settings UI), not part
 *  of the capture-only scope of Etapa 1. */
export const DEFAULT_OPT_OUT_CONFIRMATION_TEXT =
  'Você não vai mais receber nossas campanhas de marketing. Pra voltar a receber, responda VOLTAR.'
export const DEFAULT_OPT_OUT_REACTIVATION_TEXT =
  'Pronto! Você volta a receber nossas campanhas de marketing.'
