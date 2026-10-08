"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import type { DealTask, Profile } from "@/types";
import { Input } from "@/components/ui/input";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";

function isOverdue(task: DealTask): boolean {
  return !task.completed_at && !!task.due_at && new Date(task.due_at) < new Date();
}

function formatDueDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Fase 6 — aba Tarefas (deal_tasks, migration 103). Mesmo espírito de
 * DealProductsEditor: componente autocontido (busca e persiste
 * sozinho), sem edição de título depois de criada — só completar/
 * reabrir e excluir, suficiente pro escopo desta etapa.
 */
export function DealTasksTab({ dealId, profiles }: { dealId: string; profiles: Profile[] }) {
  const t = useTranslations("pipelines.dealDetail");
  const supabase = createClient();
  const { accountId, user } = useAuth();

  const [tasks, setTasks] = useState<DealTask[]>([]);
  const [loading, setLoading] = useState(true);

  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDueAt, setNewDueAt] = useState("");
  const [newAssignedTo, setNewAssignedTo] = useState("");
  const [savingNew, setSavingNew] = useState(false);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("deal_tasks")
        .select("*")
        .eq("deal_id", dealId)
        .order("due_at", { ascending: true, nullsFirst: false });
      if (cancelled) return;
      setTasks((data ?? []) as DealTask[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId, supabase]);

  const openTasks = tasks
    .filter((task) => !task.completed_at)
    .sort((a, b) => {
      if (!a.due_at && !b.due_at) return 0;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    });
  const doneTasks = tasks.filter((task) => task.completed_at);

  async function handleAddTask() {
    if (!accountId || !newTitle.trim()) return;
    setSavingNew(true);
    const { data, error } = await supabase
      .from("deal_tasks")
      .insert({
        account_id: accountId,
        deal_id: dealId,
        title: newTitle.trim(),
        due_at: newDueAt ? new Date(newDueAt).toISOString() : null,
        assigned_to: newAssignedTo || null,
        created_by: user?.id ?? null,
      })
      .select()
      .single();
    setSavingNew(false);
    if (error || !data) {
      toast.error(t("tasksSaveFailed"));
      return;
    }
    setTasks((prev) => [...prev, data as DealTask]);
    setNewTitle("");
    setNewDueAt("");
    setNewAssignedTo("");
    setAdding(false);
  }

  async function handleToggle(task: DealTask) {
    setTogglingId(task.id);
    const completedAt = task.completed_at ? null : new Date().toISOString();
    const { error } = await supabase
      .from("deal_tasks")
      .update({ completed_at: completedAt })
      .eq("id", task.id);
    setTogglingId(null);
    if (error) {
      toast.error(t("tasksSaveFailed"));
      return;
    }
    setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, completed_at: completedAt } : x)));
  }

  async function handleDelete(taskId: string) {
    setDeletingId(taskId);
    const { error } = await supabase.from("deal_tasks").delete().eq("id", taskId);
    setDeletingId(null);
    if (error) {
      toast.error(t("tasksDeleteFailed"));
      return;
    }
    setTasks((prev) => prev.filter((x) => x.id !== taskId));
  }

  function assigneeLabel(assignedTo?: string | null): string | null {
    if (!assignedTo) return null;
    const p = profiles.find((prof) => prof.id === assignedTo);
    return p?.full_name || p?.email || null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("tasksLabel")}
        </span>
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label={t("tasksAdd")}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {adding && (
        <div className="space-y-2 rounded-lg border border-border p-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t("tasksTitlePlaceholder")}
            className="h-8 border-border bg-muted text-xs text-foreground"
            autoFocus
          />
          <div className="flex gap-2">
            <Input
              type="date"
              value={newDueAt}
              onChange={(e) => setNewDueAt(e.target.value)}
              className="h-8 flex-1 border-border bg-muted text-xs text-foreground"
            />
            <select
              value={newAssignedTo}
              onChange={(e) => setNewAssignedTo(e.target.value)}
              className="h-8 flex-1 rounded-lg border border-border bg-muted px-2 text-xs text-foreground"
            >
              <option value="">{t("tasksNoAssignee")}</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewTitle("");
                setNewDueAt("");
                setNewAssignedTo("");
              }}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleAddTask}
              disabled={savingNew || !newTitle.trim()}
              className="rounded p-1.5 text-primary hover:bg-muted"
            >
              {savingNew ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}

      {tasks.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">{t("tasksEmpty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {[...openTasks, ...doneTasks].map((task) => {
            const overdue = isOverdue(task);
            const assignee = assigneeLabel(task.assigned_to);
            return (
              <li
                key={task.id}
                className="group flex items-start gap-2 rounded-lg border border-border/50 p-2"
              >
                <button
                  type="button"
                  onClick={() => handleToggle(task)}
                  disabled={togglingId === task.id}
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    task.completed_at
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-transparent hover:border-primary"
                  }`}
                >
                  {togglingId === task.id ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <Check className="h-2.5 w-2.5" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs ${
                      task.completed_at ? "text-muted-foreground line-through" : "text-foreground"
                    }`}
                  >
                    {task.title}
                  </p>
                  {(task.due_at || assignee) && (
                    <p className={`mt-0.5 text-[11px] ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
                      {task.due_at && formatDueDate(task.due_at)}
                      {task.due_at && assignee && " · "}
                      {assignee}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(task.id)}
                  disabled={deletingId === task.id}
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100"
                >
                  {deletingId === task.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
