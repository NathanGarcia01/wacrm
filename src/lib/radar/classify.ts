// ============================================================
// Fase 2 (Radar + Follow-up seguro) — Etapa A: semântica pura dos
// dois grupos do Radar. A filtragem REAL em produção acontece na RPC
// get_radar_conversations (migration 133) por performance — nenhuma
// tela carrega todas as conversas da conta no cliente para decidir
// grupo linha por linha. Este módulo existe para documentar/testar
// essa semântica em isolamento (fronteiras de 2h/24h, qual sender_type
// cai em qual grupo) e para a Etapa B reaproveitar quando precisar da
// mesma decisão de "está parado?" fora da query SQL.
// ============================================================

import { isSessionWindowOpen } from "@/lib/whatsapp/session-window";
import type { RadarGroup } from "@/types";

// Re-exported for existing callers — the real implementation moved to
// session-window.ts (Fase 2, Etapa B) since Follow-up seguro needed
// the exact same check outside Radar.
export { isSessionWindowOpen };

export interface RadarClassifyInput {
  last_message_sender_type: string | null;
  last_message_at: string | null;
  last_customer_message_at?: string | null;
}

export interface RadarThresholds {
  /** Horas desde last_message_at (sender=customer) para cair em
   *  "awaiting_us". */
  waitingHours: number;
  /** Horas desde last_message_at (sender=agent|bot) para cair em
   *  "customer_cooled". */
  cooledHours: number;
}

/**
 * Qual dos dois grupos do Radar esta conversa pertence, ou null se
 * nenhum (ainda não passou do limite, ou não tem last_message_at).
 * `now` injetado — mesma convenção de presence.ts/decide.ts — para
 * manter determinístico em teste.
 */
export function classifyRadarRow(
  input: RadarClassifyInput,
  thresholds: RadarThresholds,
  now: number,
): RadarGroup | null {
  if (!input.last_message_at || !input.last_message_sender_type) return null;

  const hoursSinceLastMessage = (now - new Date(input.last_message_at).getTime()) / (1000 * 60 * 60);

  if (input.last_message_sender_type === "customer") {
    return hoursSinceLastMessage >= thresholds.waitingHours ? "awaiting_us" : null;
  }

  if (input.last_message_sender_type === "agent" || input.last_message_sender_type === "bot") {
    return hoursSinceLastMessage >= thresholds.cooledHours ? "customer_cooled" : null;
  }

  return null;
}
