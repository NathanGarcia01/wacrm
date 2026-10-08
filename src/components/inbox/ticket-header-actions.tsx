"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  Loader2,
  LogOut,
  MessageCirclePlus,
  UserPlus,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TICKET_PROTOCOL_UI_ENABLED } from "@/lib/feature-flags";
import type { Profile, Ticket, TicketStatus } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { TransferTicketDialog } from "./transfer-ticket-dialog";
import { CloseTicketDialog } from "./close-ticket-dialog";

const STATUS_STYLE: Record<TicketStatus, string> = {
  pending: "border-transparent bg-amber-500/15 text-amber-500",
  in_progress: "border-transparent bg-primary-soft text-primary",
  closed: "border-transparent bg-muted text-muted-foreground",
};

/**
 * Fase 1 (atendimento), Etapa 6 — replaces the pre-tickets status +
 * assign dropdowns in the chat header when accounts.tickets_ui_enabled
 * is true (message-thread.tsx branches on that flag). Every action
 * here is a real server round trip — none of them are optimistic-
 * then-reconciled like the old assign dropdown; `onTicketChange`
 * fires only after the server confirms, with the authoritative
 * updated (or newly-created) ticket row.
 *
 * `ticket` is nullable: null means this conversation has no ticket
 * at all (never qualified for one — see migration 072's eligibility
 * rule). `ticket.status === 'closed'` and `ticket === null` render
 * the same way: a protocol badge if there's a closed one to show,
 * plus "Abrir atendimento" instead of the four actions — there's
 * nothing open to assign/transfer/return/close.
 */
export function TicketHeaderActions({
  ticket,
  conversationId,
  profiles,
  currentUserId,
  onTicketChange,
}: {
  ticket: Ticket | null;
  conversationId: string;
  profiles: Profile[];
  currentUserId: string | undefined;
  onTicketChange: (ticket: Ticket) => void;
}) {
  const t = useTranslations("inbox.tickets.header");
  const tStatus = useTranslations("inbox.tickets.tabs");
  const [assigning, setAssigning] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [opening, setOpening] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const isOpenTicket = ticket != null && ticket.status !== "closed";
  const currentAssignee = ticket
    ? profiles.find((p) => p.user_id === ticket.assigned_agent_id)
    : undefined;

  async function handleAssign(agentId: string) {
    if (!ticket) return;
    setAssigning(agentId);
    const res = await fetch(`/api/tickets/${ticket.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    setAssigning(null);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error ?? t("assignFailed"));
      return;
    }
    const { ticket: updated } = await res.json();
    onTicketChange(updated);
  }

  async function handleReturnToQueue() {
    if (!ticket) return;
    setReturning(true);
    const res = await fetch(`/api/tickets/${ticket.id}/return-to-queue`, { method: "POST" });
    setReturning(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error ?? t("returnFailed"));
      return;
    }
    const { ticket: updated } = await res.json();
    onTicketChange(updated);
    toast.success(t("returnedToQueue"));
  }

  async function handleOpenAttendance() {
    setOpening(true);
    const res = await fetch("/api/tickets/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId }),
    });
    setOpening(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error ?? t("openFailed"));
      return;
    }
    const { ticket: opened } = await res.json();
    onTicketChange(opened);
    toast.success(t("opened"));
  }

  return (
    <div className="flex items-center gap-2">
      {TICKET_PROTOCOL_UI_ENABLED && ticket && (
        <Badge variant="outline" className="gap-1 font-mono text-[10px]">
          #{ticket.protocol_number}
        </Badge>
      )}
      {ticket && (
        <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLE[ticket.status])}>
          {tStatus(ticket.status === "in_progress" ? "inProgress" : ticket.status)}
        </Badge>
      )}

      {isOpenTicket && ticket ? (
        <>
          {/* Atribuir */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs hover:bg-muted",
                ticket.assigned_agent_id ? "text-primary" : "text-muted-foreground",
              )}
            >
              <UserPlus className="h-3 w-3" />
              <span className="hidden sm:inline">
                {ticket.assigned_agent_id ? currentAssignee?.full_name ?? t("assigned") : t("assign")}
              </span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-border bg-popover">
              {currentUserId && (
                <DropdownMenuItem
                  onClick={() => handleAssign(currentUserId)}
                  disabled={assigning === currentUserId}
                  className={cn(
                    "text-sm",
                    ticket.assigned_agent_id === currentUserId
                      ? "text-primary"
                      : "text-popover-foreground",
                  )}
                >
                  <span className="flex-1">{t("assignToMe")}</span>
                  {assigning === currentUserId && <Loader2 className="ml-2 h-3 w-3 animate-spin" />}
                  {ticket.assigned_agent_id === currentUserId && <Check className="ml-2 h-3 w-3" />}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="bg-border" />
              {profiles
                .filter((p) => p.user_id !== currentUserId)
                .map((p) => {
                  const isSelected = p.user_id === ticket.assigned_agent_id;
                  return (
                    <DropdownMenuItem
                      key={p.user_id}
                      onClick={() => handleAssign(p.user_id)}
                      disabled={assigning === p.user_id}
                      className={cn("text-sm", isSelected ? "text-primary" : "text-popover-foreground")}
                    >
                      <span className="flex-1">{p.full_name}</span>
                      {assigning === p.user_id && <Loader2 className="ml-2 h-3 w-3 animate-spin" />}
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Transferir */}
          <button
            type="button"
            onClick={() => setTransferOpen(true)}
            className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowRightLeft className="h-3 w-3" />
            <span className="hidden sm:inline">{t("transfer")}</span>
          </button>

          {/* Devolver à fila */}
          <button
            type="button"
            onClick={handleReturnToQueue}
            disabled={returning}
            className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {returning ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
            <span className="hidden sm:inline">{t("returnToQueue")}</span>
          </button>

          {/* Fechar */}
          <button
            type="button"
            onClick={() => setCloseOpen(true)}
            className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            <XCircle className="h-3 w-3" />
            <span className="hidden sm:inline">{t("close")}</span>
          </button>
        </>
      ) : (
        /* Sem ticket aberto (nunca teve, ou o último está fechado) —
           nada pra atribuir/transferir/devolver/fechar. Única ação
           possível é abrir um novo atendimento manualmente. */
        <button
          type="button"
          onClick={handleOpenAttendance}
          disabled={opening}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-primary-soft disabled:opacity-50"
        >
          {opening ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageCirclePlus className="h-3 w-3" />}
          <span className="hidden sm:inline">{t("openAttendance")}</span>
        </button>
      )}

      {ticket && (
        <>
          <TransferTicketDialog
            open={transferOpen}
            onOpenChange={setTransferOpen}
            ticket={ticket}
            profiles={profiles}
            currentUserId={currentUserId}
            onTransferred={onTicketChange}
          />
          <CloseTicketDialog
            open={closeOpen}
            onOpenChange={setCloseOpen}
            ticket={ticket}
            onClosed={onTicketChange}
          />
        </>
      )}
    </div>
  );
}
