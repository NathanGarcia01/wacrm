/**
 * Fase 1 (atendimento) — Etapa 4 kill switch. Every ticket side effect
 * (webhook, send route, UI actions, automations, flows) is gated on
 * this — default off, so deploying Etapa 4's code changes nothing
 * until TICKETS_ENABLED=true is set in the environment (and can be
 * flipped back off immediately if something goes wrong).
 */
export function ticketsEnabled(): boolean {
  return process.env.TICKETS_ENABLED === 'true'
}
