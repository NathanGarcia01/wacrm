// ============================================================
// Fase 1 (distribuição automática de tickets) — Etapa 2: a função
// pura de decisão. Inspirada no design (não no código) de
// github.com/melgarafael/DeskcommCRM's lib/routing/decide.ts +
// eligibility.ts — mesma ideia de "candidatos pré-resolvidos entram,
// um agente (ou nada) sai", reescrita do zero para o schema e as
// regras desta base.
//
// Pura e sem I/O de propósito: todo dado variável (presença,
// contagem de tickets em andamento, quando cada agente foi atribuído
// por último) chega já resolvido em `candidates` — quem monta essa
// lista (src/lib/routing/cycle.ts) é quem fala com o banco e com
// presence.ts. Isso deixa esta função 100% testável com fixtures
// simples, sem mockar Supabase.
// ============================================================

import type { AccountRole } from "@/lib/auth/roles";
import type { PresenceStatus } from "@/lib/presence";
import type { RoutingMode } from "@/types";

/** Modo em que o ciclo automático de fato decide algo — 'manual'
 *  nunca chega aqui, o chamador filtra a conta antes. */
export type RoutingDecisionMode = Exclude<RoutingMode, "manual">;

export interface RoutingTicketInput {
  id: string;
  /** Null = ticket sem departamento, qualquer candidato elegível
   *  (sujeito às outras regras) pode receber. */
  departmentId: string | null;
}

export interface RoutingCandidate {
  userId: string;
  role: AccountRole;
  /** Departamentos de que este membro faz parte. Vazio = não
   *  pertence a nenhum. */
  departmentIds: string[];
  /** Já derivada (presence.ts' derivePresence) pelo chamador — esta
   *  função não deriva presença, só decide com base nela. */
  presenceStatus: PresenceStatus;
  isEnabled: boolean;
  capacity: number;
  inProgressCount: number;
  /** Epoch ms da última atribuição automática (routing_assignment_events).
   *  Null = nunca recebeu uma — tem prioridade no rodízio. */
  lastAssignedAt: number | null;
}

export interface RoutingDecision {
  agentId: string;
  /** Motivo gravado em routing_assignment_events.reason — valores
   *  estáveis, não traduzidos (é log técnico, não UI). */
  reason:
    | "round_robin_never_assigned"
    | "round_robin_oldest"
    | "load_least_busy"
    | "load_tiebreak_round_robin";
}

/**
 * Elegibilidade (regra 2 da especificação): habilitado, não-viewer,
 * presença online OU away (offline — derivado por staleness em
 * presence.ts — sempre exclui), pertence ao departamento do ticket
 * quando o ticket tem um, e tem folga de capacidade.
 */
export function isEligibleCandidate(
  ticket: RoutingTicketInput,
  candidate: RoutingCandidate,
): boolean {
  if (!candidate.isEnabled) return false;
  if (candidate.role === "viewer") return false;
  if (candidate.presenceStatus === "offline") return false;
  if (ticket.departmentId !== null && !candidate.departmentIds.includes(ticket.departmentId)) {
    return false;
  }
  if (candidate.inProgressCount >= candidate.capacity) return false;
  return true;
}

/**
 * Ordena por critério de rodízio: quem nunca recebeu (lastAssignedAt
 * null) primeiro, depois quem recebeu há mais tempo. Empate exato
 * (dois nulls, ou dois mesmos timestamps) resolve por userId — só
 * para ter uma ordem determinística e estável entre execuções, não
 * carrega significado de negócio.
 */
function compareRoundRobin(a: RoutingCandidate, b: RoutingCandidate): number {
  if (a.lastAssignedAt === null && b.lastAssignedAt !== null) return -1;
  if (a.lastAssignedAt !== null && b.lastAssignedAt === null) return 1;
  if (a.lastAssignedAt !== null && b.lastAssignedAt !== null && a.lastAssignedAt !== b.lastAssignedAt) {
    return a.lastAssignedAt - b.lastAssignedAt;
  }
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}

/**
 * Decide quem recebe `ticket`, ou null se não há elegível — nesse
 * caso o ticket continua na fila, sem erro (regra 4). `mode='manual'`
 * não é um valor válido aqui de propósito: o ciclo nem chama esta
 * função para uma conta em modo manual (ver cycle.ts).
 */
export function decideAssignment(
  ticket: RoutingTicketInput,
  candidates: RoutingCandidate[],
  mode: RoutingDecisionMode,
): RoutingDecision | null {
  const eligible = candidates.filter((c) => isEligibleCandidate(ticket, c));
  if (eligible.length === 0) return null;

  if (mode === "round_robin") {
    const [chosen] = [...eligible].sort(compareRoundRobin);
    return {
      agentId: chosen.userId,
      reason: chosen.lastAssignedAt === null ? "round_robin_never_assigned" : "round_robin_oldest",
    };
  }

  // mode === 'load': menor carga (in_progress) vence; empate cai no
  // mesmo critério de rodízio (regra 5).
  const sorted = [...eligible].sort((a, b) => {
    if (a.inProgressCount !== b.inProgressCount) return a.inProgressCount - b.inProgressCount;
    return compareRoundRobin(a, b);
  });
  const [chosen] = sorted;
  const tied = eligible.filter((c) => c.inProgressCount === chosen.inProgressCount).length > 1;
  return {
    agentId: chosen.userId,
    reason: tied ? "load_tiebreak_round_robin" : "load_least_busy",
  };
}
