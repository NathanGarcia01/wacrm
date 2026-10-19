"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  CircleCheck,
  CircleAlert,
  Clock,
  Hourglass,
  UserPlus,
  PlayCircle,
  PauseCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Run history viewer.
 *
 * Lists the 50 most recent runs for a flow, newest first. Each row
 * collapses to a one-liner (contact + status + time); expanding shows
 * the full `flow_run_events` timeline for that run — useful for
 * debugging "why didn't my flow advance?" by surfacing the engine's
 * own log.
 */

interface RunRow {
  id: string;
  status:
    | "active"
    | "waiting_reply"
    | "completed"
    | "handed_off"
    | "timed_out"
    | "cancelled"
    | "paused_by_agent"
    | "failed";
  current_node_key: string | null;
  started_at: string;
  last_advanced_at: string;
  ended_at: string | null;
  end_reason: string | null;
  vars: Record<string, unknown>;
  reprompt_count: number;
  contact: { id: string; name: string | null; phone: string } | null;
}

interface EventRow {
  flow_run_id: string;
  event_type: string;
  node_key: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const STATUS_META: Record<
  RunRow["status"],
  { label: string; classes: string; icon: typeof Clock }
> = {
  active: {
    label: "Ativo",
    classes: "border-primary/40 bg-primary/10 text-primary",
    icon: PlayCircle,
  },
  waiting_reply: {
    label: "Aguardando resposta",
    classes: "border-amber-400/40 bg-amber-400/10 text-amber-500",
    icon: Hourglass,
  },
  completed: {
    label: "Concluído",
    classes: "border-border bg-muted text-muted-foreground",
    icon: CircleCheck,
  },
  handed_off: {
    label: "Transferido",
    classes: "border-gold/40 bg-gold-soft text-gold",
    icon: UserPlus,
  },
  timed_out: {
    label: "Tempo esgotado",
    classes: "border-border bg-muted/60 text-muted-foreground",
    icon: Clock,
  },
  cancelled: {
    label: "Cancelado",
    classes: "border-border bg-muted/60 text-muted-foreground",
    icon: Clock,
  },
  paused_by_agent: {
    label: "Pausado pelo atendente",
    classes: "border-border bg-muted text-muted-foreground",
    icon: PauseCircle,
  },
  failed: {
    label: "Falhou",
    classes: "border-destructive/40 bg-destructive/10 text-destructive",
    icon: CircleAlert,
  },
};

/** pt-BR label for every distinct `reason` the engine logs in event
 *  payloads and/or uses as `flow_runs.end_reason` — see engine.ts /
 *  cron/route.ts. Falls back to the raw value for anything new that
 *  hasn't been added here yet, so an unmapped reason is still visible
 *  (just untranslated) rather than silently hidden. */
const REASON_LABELS: Record<string, string> = {
  advance_loop_safety_break: "Loop de segurança do fluxo foi acionado",
  advance_loop_overflow: "Loop de segurança do fluxo foi acionado",
  assign_conversation_failed: "Falha ao atribuir a conversa",
  collect_input_prompt_failed: "Falha ao enviar a pergunta",
  collect_input_resend_failed: "Falha ao reenviar a pergunta",
  reprompt_send_failed: "Falha ao reenviar a pergunta",
  condition_evaluation_failed: "Falha ao avaliar a condição",
  conversation_closed: "Conversa encerrada",
  opted_out: "Contato pediu para sair (opt-out)",
  fallback_exhausted: "Reenvios esgotados",
  fallback_exhausted_end: "Reenvios esgotados — fluxo encerrado",
  lost_race_during_advance: "Concorrência ao avançar o fluxo",
  mark_deal_lost_failed: "Falha ao marcar negócio como perdido",
  update_deal_stage_failed: "Falha ao atualizar a etapa do negócio",
  node_not_found: "Nó não encontrado",
  current_node_not_found: "Nó atual não encontrado",
  active_run_missing_current_node: "Execução ativa sem nó atual (erro interno)",
  open_conversation_failed: "Falha ao abrir a conversa",
  send_media_failed: "Falha ao enviar a mídia",
  send_text_failed: "Falha ao enviar a mensagem",
  set_tag_failed: "Falha ao definir a tag",
  end_node: "Chegou ao nó de fim",
  handoff_node: "Transferido para atendimento",
  flow_has_no_entry_node: "Fluxo sem nó de entrada",
  missing_next_node: "Próximo nó não definido",
  unknown_node_type: "Tipo de nó desconhecido",
  wait_for_reply_timeout: "Tempo de espera por resposta esgotado",
  wait_for_reply_missing_timeout_node: 'Nó de "sem resposta" não definido',
  stale_sweep: "Encerrado por inatividade (varredura automática)",
  // start_flow ("Iniciar outro fluxo", migration 114)
  start_flow: "Iniciou outro fluxo",
  start_flow_self_reference: "Bloqueado: tentativa de iniciar o próprio fluxo",
  start_flow_chain_limit_reached: "Bloqueado: limite de encadeamento de fluxos atingido",
  start_flow_target_unavailable: "Fluxo de destino indisponível (inativo ou não encontrado)",
  start_flow_chained_insert_failed: "Falha ao iniciar o próximo fluxo",
};

function reasonLabel(reason: unknown): string {
  if (typeof reason !== "string") return String(reason);
  return REASON_LABELS[reason] ?? reason;
}

export default function FlowRunsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [flow, setFlow] = useState<{ id: string; name: string } | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/flows/${params.id}/runs`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = (await res.json()) as {
          flow: { id: string; name: string };
          runs: RunRow[];
          events: EventRow[];
        };
        if (!cancelled) {
          setFlow(json.flow);
          setRuns(json.runs ?? []);
          setEvents(json.events ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("Não foi possível carregar as execuções.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  function toggle(runId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (notFound || !flow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Fluxo não encontrado.</p>
        <button
          type="button"
          onClick={() => router.push("/flows")}
          className="text-sm text-primary hover:opacity-80"
        >
          ← Voltar para Fluxos
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <button
        type="button"
        onClick={() => router.push(`/flows/${flow.id}`)}
        className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        {flow.name}
      </button>
      <h1 className="text-xl font-semibold text-foreground">Execuções</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        As 50 execuções mais recentes deste fluxo. Expanda uma linha para ver o
        registro passo a passo do motor.
      </p>

      {runs.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center text-sm text-muted-foreground">
          Nenhuma execução ainda. Acione o fluxo a partir de um número de
          WhatsApp pessoal para vê-la aparecer aqui.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              events={events.filter((e) => e.flow_run_id === run.id)}
              expanded={expanded.has(run.id)}
              onToggle={() => toggle(run.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunCard({
  run,
  events,
  expanded,
  onToggle,
}: {
  run: RunRow;
  events: EventRow[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = STATUS_META[run.status];
  const StatusIcon = meta.icon;
  const contactLabel =
    run.contact?.name?.trim() || run.contact?.phone || "Contato desconhecido";
  const duration = run.ended_at
    ? formatDistanceToNow(new Date(run.ended_at), {
        addSuffix: false,
      })
    : null;
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {contactLabel}
            </span>
            <Badge variant="outline" className={cn("gap-1", meta.classes)}>
              <StatusIcon className="h-3 w-3" />
              {meta.label}
            </Badge>
            {(run.status === "active" || run.status === "waiting_reply") && run.current_node_key && (
              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                em {run.current_node_key}
              </code>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono">Iniciado em {format(new Date(run.started_at), "PP p")}</span>
            {run.reprompt_count > 0 && (
              <span className="font-mono">· {run.reprompt_count} reenvio{run.reprompt_count === 1 ? "" : "s"}</span>
            )}
            {duration && <span className="font-mono">· durou {duration}</span>}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3">
          {Object.keys(run.vars).length > 0 && (
            <details className="mb-3">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Variáveis capturadas ({Object.keys(run.vars).length})
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-background p-2 text-[11px] text-muted-foreground">
                {JSON.stringify(run.vars, null, 2)}
              </pre>
            </details>
          )}
          <div className="flex flex-col gap-1">
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum evento registrado para esta execução.
              </p>
            ) : (
              events.map((ev, ix) => <EventLine key={ix} ev={ev} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const EVENT_COLOR: Record<string, string> = {
  started: "text-primary",
  node_entered: "text-muted-foreground",
  message_sent: "text-sky-300",
  reply_received: "text-primary",
  fallback_fired: "text-gold",
  handoff: "text-gold",
  timeout: "text-muted-foreground",
  cancelled: "text-muted-foreground",
  error: "text-destructive",
  completed: "text-primary",
};

/** pt-BR label for each `flow_run_events.event_type` value — see
 *  logEvent's event_type union in engine.ts. */
const EVENT_TYPE_LABELS: Record<string, string> = {
  started: "Iniciado",
  node_entered: "Nó alcançado",
  message_sent: "Mensagem enviada",
  reply_received: "Resposta recebida",
  fallback_fired: "Reenvio acionado",
  handoff: "Transferência",
  timeout: "Tempo esgotado",
  cancelled: "Cancelado",
  error: "Erro",
  completed: "Concluído",
};

function EventLine({ ev }: { ev: EventRow }) {
  const cls = EVENT_COLOR[ev.event_type] ?? "text-muted-foreground";
  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1 text-xs">
      <span className="w-32 shrink-0 font-mono text-[10px] text-muted-foreground">
        {format(new Date(ev.created_at), "HH:mm:ss")}
      </span>
      <span className={cn("w-32 shrink-0 font-mono text-[10px]", cls)}>
        {EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
      </span>
      {ev.node_key && (
        <code className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
          {ev.node_key}
        </code>
      )}
      {Object.keys(ev.payload).length > 0 && (
        <span className="min-w-0 truncate text-[10px] text-muted-foreground">
          {summarizePayload(ev.payload)}
        </span>
      )}
    </div>
  );
}

/** pt-BR prefix shown before each payload value in summarizePayload. */
const PAYLOAD_KEY_LABELS: Record<string, string> = {
  reply_id: "reply_id",
  captured_key: "capturado",
  reason: "motivo",
  advancing_to: "avança para",
};

function summarizePayload(payload: Record<string, unknown>): string {
  // Show the keys that matter most to a human debugger; full JSON is
  // available via the "Variáveis capturadas" details panel for the run.
  const keys = ["reply_id", "captured_key", "reason", "advancing_to"];
  for (const k of keys) {
    if (k in payload && payload[k] !== null && payload[k] !== undefined) {
      const value = k === "reason" ? reasonLabel(payload[k]) : String(payload[k]);
      return `${PAYLOAD_KEY_LABELS[k]}=${value.slice(0, 80)}`;
    }
  }
  return "";
}
