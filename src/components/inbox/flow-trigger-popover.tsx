"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Loader2, Play, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

interface FlowSummary {
  id: string;
  name: string;
  description: string | null;
}

interface FlowTriggerPopoverProps {
  contactId: string;
  conversationId: string;
  /** Called after a flow run starts successfully, so the sidebar can
   *  show the "running" badge and refetch the run history. */
  onTriggered: (flowName: string) => void;
}

export function FlowTriggerPopover({
  contactId,
  conversationId,
  onTriggered,
}: FlowTriggerPopoverProps) {
  const t = useTranslations("inbox.flowTrigger");
  const [open, setOpen] = useState(false);
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);

  // Load the account's active flows each time the popover opens —
  // mirrors TagPickerPopover so a flow activated elsewhere shows up.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("flows")
        .select("id, name, description")
        .eq("status", "active")
        .order("name");
      if (cancelled) return;
      setFlows((data ?? []) as FlowSummary[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flows;
    return flows.filter((f) => f.name.toLowerCase().includes(q));
  }, [flows, query]);

  async function handleRun(flow: FlowSummary) {
    setRunningId(flow.id);
    try {
      const res = await fetch("/api/flows/trigger-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow_id: flow.id,
          contact_id: contactId,
          conversation_id: conversationId,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason =
          payload?.error === "contact_has_active_run"
            ? t("errorContactHasActiveRun")
            : t("errorGeneric");
        toast.error(reason);
        return;
      }
      toast.success(t("flowStarted", { name: flow.name }));
      onTriggered(flow.name);
      setOpen(false);
    } catch {
      toast.error(t("errorGeneric"));
    } finally {
      setRunningId(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/70">
        <Play className="h-3 w-3" />
        {t("triggerFlow")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-8 bg-muted pl-7 text-xs"
            autoFocus
          />
        </div>

        <div className="mt-2 max-h-56 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {query ? t("noFlowsFound") : t("noActiveFlows")}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {filtered.map((flow) => (
                <li
                  key={flow.id}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {flow.name}
                    </p>
                    {flow.description && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {flow.description}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRun(flow)}
                    disabled={runningId === flow.id}
                    className="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {runningId === flow.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      t("execute")
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
