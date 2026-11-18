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

import { SESSION_WINDOW_HOURS } from "@/lib/whatsapp/session-window";
import type { RadarGroup } from "@/types";

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

/**
 * Janela de 24h do WhatsApp ainda aberta (free text permitido) ou já
 * fechada (só template) — mesma regra de conversation-list-status.ts,
 * reaproveitando SESSION_WINDOW_HOURS em vez de hardcodar 24 de novo.
 * Null (nunca ouvimos o cliente) conta como fechada — nada a reabrir.
 */
export function isSessionWindowOpen(lastCustomerMessageAt: string | null | undefined, now: number): boolean {
  if (!lastCustomerMessageAt) return false;
  const hoursSince = (now - new Date(lastCustomerMessageAt).getTime()) / (1000 * 60 * 60);
  return hoursSince < SESSION_WINDOW_HOURS;
}
