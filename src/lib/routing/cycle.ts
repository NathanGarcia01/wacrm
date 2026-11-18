// ============================================================
// Fase 1 (distribuição automática de tickets) — Etapa 2: o ciclo.
// Lê o estado necessário do banco, monta os candidatos, chama a
// função pura (decide.ts) e aplica o resultado via
// assignTicketIfUnclaimed (atômico — ver src/lib/tickets/lifecycle.ts).
//
// Chamado pelo cron (src/app/api/routing/cron/route.ts) a cada
// minuto. Nada aqui lança para fora de runRoutingCycle: um erro
// inesperado numa conta ou num ticket é contado em `errors` e o
// ciclo segue para o próximo — uma conta com dado inconsistente
// nunca trava a fila de todas as outras.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "./admin-client";
import { decideAssignment, type RoutingCandidate, type RoutingDecisionMode, type RoutingTicketInput } from "./decide";
import { assignTicketIfUnclaimed } from "@/lib/tickets/lifecycle";
import { derivePresence, type StoredPresence } from "@/lib/presence";
import { getAccountPlanFeatures } from "@/lib/billing/server";
import type { AccountRole } from "@/lib/auth/roles";

/** Quantas contas em modo automático o ciclo processa por execução
 *  — defesa contra uma execução de 1 minuto crescer sem limite se a
 *  base de contas em round_robin/load ficar grande. Contas que não
 *  couberem são pegas na próxima execução (1 min depois). */
const MAX_ACCOUNTS_PER_RUN = 50;

/** Idem, por conta: quantos tickets pendentes sem dono o ciclo tenta
 *  distribuir numa única execução. */
const MAX_TICKETS_PER_ACCOUNT_PER_RUN = 200;

/** Histórico de atribuições automáticas considerado para calcular
 *  "quem recebeu há mais tempo" (regra do rodízio) — já filtrado por
 *  agente do time atual e ordenado do mais recente para o mais
 *  antigo, então só agentes com uma atribuição muito antiga e
 *  nenhuma recente ficam de fora (tratados como "nunca recebeu",
 *  degradação aceitável, não um bug). */
const MAX_ASSIGNMENT_HISTORY_ROWS = 2000;

/** Defaults para membro sem linha em routing_member_settings. */
const DEFAULT_CAPACITY = 5;
const DEFAULT_IS_ENABLED = true;

export interface RoutingCycleSummary {
  accountsConsidered: number;
  accountsSkippedPlan: number;
  ticketsConsidered: number;
  ticketsAssigned: number;
  ticketsSkipped: number;
  errors: number;
}

function emptySummary(): RoutingCycleSummary {
  return {
    accountsConsidered: 0,
    accountsSkippedPlan: 0,
    ticketsConsidered: 0,
    ticketsAssigned: 0,
    ticketsSkipped: 0,
    errors: 0,
  };
}

/**
 * Entry point chamado pela rota de cron. `now` é injetável para
 * testes de integração futuros; produção sempre usa o default.
 */
export async function runRoutingCycle(now: Date = new Date()): Promise<RoutingCycleSummary> {
  const admin = supabaseAdmin();
  const summary = emptySummary();

  // Só contas com modo automático ligado E enabled_at preenchido —
  // enabled_at null numa conta não-manual não deveria acontecer (a
  // rota de settings sempre grava os dois juntos), mas filtrar aqui
  // também evita qualquer ambiguidade de "opened_at > null" na query
  // de tickets abaixo.
  const { data: settingsRows, error: settingsError } = await admin
    .from("routing_settings")
    .select("account_id, mode, enabled_at")
    .in("mode", ["round_robin", "load"])
    .not("enabled_at", "is", null)
    .limit(MAX_ACCOUNTS_PER_RUN);
  if (settingsError) {
    console.error("[routing/cycle] failed to load routing_settings:", settingsError);
    summary.errors++;
    return summary;
  }

  for (const row of settingsRows ?? []) {
    const accountId = row.account_id as string;
    const mode = row.mode as RoutingDecisionMode;
    const enabledAt = row.enabled_at as string;

    summary.accountsConsidered++;

    try {
      // Gate de plano no servidor (não só nas rotas de settings) —
      // uma conta que ligou round_robin/load no Pro e depois baixou
      // para Starter não deve continuar recebendo distribuição
      // automática só porque a linha ficou salva.
      const features = await getAccountPlanFeatures(admin, accountId);
      if (!features.hasRouting) {
        summary.accountsSkippedPlan++;
        continue;
      }

      const result = await runAccountCycle(admin, accountId, mode, enabledAt, now.getTime());
      summary.ticketsConsidered += result.considered;
      summary.ticketsAssigned += result.assigned;
      summary.ticketsSkipped += result.skipped;
      summary.errors += result.errors;
    } catch (err) {
      console.error(`[routing/cycle] account ${accountId} failed:`, err);
      summary.errors++;
    }
  }

  return summary;
}

interface AccountCycleResult {
  considered: number;
  assigned: number;
  skipped: number;
  errors: number;
}

async function runAccountCycle(
  admin: SupabaseClient,
  accountId: string,
  mode: RoutingDecisionMode,
  enabledAt: string,
  nowMs: number,
): Promise<AccountCycleResult> {
  const result: AccountCycleResult = { considered: 0, assigned: 0, skipped: 0, errors: 0 };

  // 1) Fila: pending, sem dono, aberto depois de enabled_at (regra 3
  // — nunca redistribui backlog anterior a ligar o modo automático).
  const { data: tickets, error: ticketsError } = await admin
    .from("tickets")
    .select("id, department_id")
    .eq("account_id", accountId)
    .eq("status", "pending")
    .is("assigned_agent_id", null)
    .gt("opened_at", enabledAt)
    .order("opened_at", { ascending: true })
    .limit(MAX_TICKETS_PER_ACCOUNT_PER_RUN);
  if (ticketsError) throw ticketsError;
  if (!tickets || tickets.length === 0) return result;

  // 2) Membros da conta + papel (viewer nunca é candidato).
  const { data: profileRows, error: profilesError } = await admin
    .from("profiles")
    .select("user_id, account_role")
    .eq("account_id", accountId);
  if (profilesError) throw profilesError;

  const roleByUser = new Map<string, AccountRole>(
    (profileRows ?? []).map((p) => [p.user_id as string, p.account_role as AccountRole]),
  );
  const memberIds = [...roleByUser.keys()];
  if (memberIds.length === 0) return result;

  // 3) Departamentos — só os referenciados pelos tickets desta
  // leva, para não carregar a tabela inteira de department_members.
  const departmentIds = [
    ...new Set((tickets.map((t) => t.department_id) as (string | null)[]).filter((id): id is string => !!id)),
  ];
  const departmentIdsByUser = new Map<string, string[]>();
  if (departmentIds.length > 0) {
    const { data: deptMemberRows, error: deptMembersError } = await admin
      .from("department_members")
      .select("department_id, user_id")
      .in("department_id", departmentIds);
    if (deptMembersError) throw deptMembersError;
    for (const row of deptMemberRows ?? []) {
      const userId = row.user_id as string;
      const list = departmentIdsByUser.get(userId) ?? [];
      list.push(row.department_id as string);
      departmentIdsByUser.set(userId, list);
    }
  }

  // 4) Presença — mesma derivação do roster (presence.ts). Elegível:
  // online OU away; offline (derivado por staleness) sempre exclui.
  const { data: presenceRows, error: presenceError } = await admin
    .from("member_presence")
    .select("user_id, status, last_seen_at")
    .eq("account_id", accountId)
    .in("user_id", memberIds);
  if (presenceError) throw presenceError;
  const presenceByUser = new Map(
    (presenceRows ?? []).map((p) => [
      p.user_id as string,
      { status: p.status as StoredPresence, lastSeenAt: p.last_seen_at as string },
    ]),
  );

  // 5) Capacidade / participação — default para quem não tem linha.
  const { data: memberSettingsRows, error: memberSettingsError } = await admin
    .from("routing_member_settings")
    .select("user_id, capacity, is_enabled")
    .eq("account_id", accountId)
    .in("user_id", memberIds);
  if (memberSettingsError) throw memberSettingsError;
  const memberSettingsByUser = new Map(
    (memberSettingsRows ?? []).map((r) => [
      r.user_id as string,
      { capacity: r.capacity as number, isEnabled: r.is_enabled as boolean },
    ]),
  );

  // 6) Carga atual — tickets in_progress por agente.
  const { data: inProgressRows, error: inProgressError } = await admin
    .from("tickets")
    .select("assigned_agent_id")
    .eq("account_id", accountId)
    .eq("status", "in_progress")
    .not("assigned_agent_id", "is", null);
  if (inProgressError) throw inProgressError;
  const inProgressCountByUser = new Map<string, number>();
  for (const row of inProgressRows ?? []) {
    const agentId = row.assigned_agent_id as string;
    inProgressCountByUser.set(agentId, (inProgressCountByUser.get(agentId) ?? 0) + 1);
  }

  // 7) Última atribuição automática por agente — para o critério de
  // rodízio. Ordenado do mais recente para o mais antigo; mantém só
  // a primeira ocorrência (= mais recente) de cada agente.
  const { data: lastAssignedRows, error: lastAssignedError } = await admin
    .from("routing_assignment_events")
    .select("agent_id, created_at")
    .eq("account_id", accountId)
    .in("agent_id", memberIds)
    .order("created_at", { ascending: false })
    .limit(MAX_ASSIGNMENT_HISTORY_ROWS);
  if (lastAssignedError) throw lastAssignedError;
  const lastAssignedAtByUser = new Map<string, number>();
  for (const row of lastAssignedRows ?? []) {
    const agentId = row.agent_id as string;
    if (!lastAssignedAtByUser.has(agentId)) {
      lastAssignedAtByUser.set(agentId, new Date(row.created_at as string).getTime());
    }
  }

  const candidates: RoutingCandidate[] = memberIds.map((userId) => {
    const presence = presenceByUser.get(userId);
    const memberSettings = memberSettingsByUser.get(userId);
    return {
      userId,
      role: roleByUser.get(userId) as AccountRole,
      departmentIds: departmentIdsByUser.get(userId) ?? [],
      presenceStatus: derivePresence(presence?.status, presence?.lastSeenAt ?? null, nowMs),
      isEnabled: memberSettings?.isEnabled ?? DEFAULT_IS_ENABLED,
      capacity: memberSettings?.capacity ?? DEFAULT_CAPACITY,
      inProgressCount: inProgressCountByUser.get(userId) ?? 0,
      lastAssignedAt: lastAssignedAtByUser.get(userId) ?? null,
    };
  });

  for (const ticketRow of tickets) {
    result.considered++;
    const ticket: RoutingTicketInput = {
      id: ticketRow.id as string,
      departmentId: (ticketRow.department_id as string | null) ?? null,
    };

    try {
      const decision = decideAssignment(ticket, candidates, mode);
      if (!decision) {
        // Sem elegível — ticket continua na fila, sem erro (regra 4).
        result.skipped++;
        continue;
      }

      const assigned = await assignTicketIfUnclaimed(ticket.id, decision.agentId, {
        automated: true,
        mode,
        reason: decision.reason,
      });
      if (!assigned) {
        // Perdeu a corrida — outro ciclo sobreposto ou uma atribuição
        // manual chegou primeiro. Não é erro; não atualiza o estado
        // em memória do candidato, que não recebeu nada de fato.
        result.skipped++;
        continue;
      }

      const { error: auditError } = await admin.from("routing_assignment_events").insert({
        account_id: accountId,
        ticket_id: ticket.id,
        agent_id: decision.agentId,
        mode,
        reason: decision.reason,
      });
      if (auditError) throw auditError;

      // Atualiza carga e lastAssignedAt em memória para a PRÓXIMA
      // iteração deste mesmo ciclo já ver o candidato mais ocupado /
      // recém-atribuído (regra 4) — sem isso, dois tickets seguidos
      // sem departamento cairiam sempre no mesmo agente até o
      // próximo tick.
      const idx = candidates.findIndex((c) => c.userId === decision.agentId);
      if (idx !== -1) {
        candidates[idx] = {
          ...candidates[idx],
          inProgressCount: candidates[idx].inProgressCount + 1,
          lastAssignedAt: nowMs,
        };
      }

      result.assigned++;
    } catch (err) {
      console.error(`[routing/cycle] account ${accountId} ticket ${ticket.id} failed:`, err);
      result.errors++;
    }
  }

  return result;
}
