"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { CONTACT_STATUS_LEAD_ORIGIN_UI_ENABLED } from "@/lib/feature-flags";
import { toast } from "sonner";
import { fireAutomationTrigger } from "@/lib/automations/client-dispatch";
import type {
  ContactStatus,
  CustomField,
  Deal,
  DealEvent,
  LeadOrigin,
  PipelineStage,
  Profile,
  Tag,
} from "@/types";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Phone,
  Mail,
  Calendar,
  Clock,
  User,
  Pencil,
  UserCircle2,
  Compass,
  Info,
  MessageCircle,
  CheckSquare,
  FileText,
  History,
} from "lucide-react";
import { DealStageBar } from "./deal-stage-bar";
import { DealProductsEditor } from "./deal-products-editor";
import { DealWinLossActions } from "./deal-win-loss-actions";
import { DealConversationTab } from "./deal-conversation-tab";
import { DealTasksTab } from "./deal-tasks-tab";
import { DealFilesTab } from "./deal-files-tab";
import { DealEventsTab } from "./deal-events-tab";

type PanelTab = "data" | "conversation" | "tasks" | "files" | "events";

function ymdInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    date,
  );
}

/**
 * Diferença em DIAS DE CALENDÁRIO no fuso da conta, não em blocos de
 * 24h — um negócio criado ontem às 23h mostra "1 dia", não "0 dias"
 * só porque ainda não completou 24h corridas.
 */
function calendarDaysSince(iso: string, timezone: string, now: Date = new Date()): number {
  const [y1, m1, d1] = ymdInTimezone(new Date(iso), timezone).split("-").map(Number);
  const [y2, m2, d2] = ymdInTimezone(now, timezone).split("-").map(Number);
  const startUtc = Date.UTC(y1, m1 - 1, d1);
  const nowUtc = Date.UTC(y2, m2 - 1, d2);
  return Math.max(0, Math.round((nowUtc - startUtc) / 86_400_000));
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Fase 6 (negócio com conversa embutida), Etapa 1 — painel grande que
 * substitui o Sheet (deal-form.tsx) ao abrir um card EXISTENTE do
 * board. O Sheet continua existindo só para criar negócio (decisão
 * explícita) — editar campos "de formulário" (título, contato, moeda)
 * ainda passa por lá via o botão "Editar campos" aqui, reaproveitando
 * 100% daquela lógica em vez de duplicá-la.
 *
 * Conversa/Tarefas/Arquivos vêm em etapas seguintes — por ora só a
 * aba Registros já lê deal_events (migration 101) de verdade; as
 * outras são placeholder.
 */
export function DealDetailPanel({
  open,
  onOpenChange,
  deal,
  stages,
  profiles,
  onSaved,
  onEditFields,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal | null;
  stages: PipelineStage[];
  profiles: Profile[];
  /** Called after any mutation made directly from this panel (stage
   *  move, won/lost, product edit) — parent re-fetches `deals`, which
   *  flows back into this panel's `deal` prop since the parent looks
   *  the deal up by id from its own live array. */
  onSaved: () => void;
  /** Opens the existing create/edit Sheet (deal-form.tsx) for this
   *  deal — title/contact/currency/stage/assignee/forecast/notes. */
  onEditFields: (deal: Deal) => void;
}) {
  const t = useTranslations("pipelines.dealDetail");
  const tForm = useTranslations("pipelines.dealForm");
  const supabase = createClient();
  const { defaultCurrency, account } = useAuth();
  const timezone = account?.timezone ?? "America/Sao_Paulo";

  const [tags, setTags] = useState<Tag[]>([]);
  const [statuses, setStatuses] = useState<ContactStatus[]>([]);
  const [leadOrigins, setLeadOrigins] = useState<LeadOrigin[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<DealEvent[]>([]);
  const [movingStageId, setMovingStageId] = useState<string | null>(null);
  const [updatingAssignee, setUpdatingAssignee] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>("conversation");

  const contact = deal?.contact ?? null;

  useEffect(() => {
    if (!open || !deal?.contact_id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTags([]);
      setCustomValues({});
      setEvents([]);
      setActiveTab("conversation");
      return;
    }
    let cancelled = false;
    (async () => {
      const [tagsRes, statusesRes, originsRes, fieldsRes, valuesRes, eventsRes] = await Promise.all([
        supabase.from("contact_tags").select("tag_id, tags(*)").eq("contact_id", deal.contact_id!),
        supabase.from("contact_statuses").select("*").order("position"),
        supabase.from("lead_origins").select("*").order("position"),
        supabase.from("custom_fields").select("*").order("field_name"),
        supabase.from("contact_custom_values").select("*").eq("contact_id", deal.contact_id!),
        supabase.from("deal_events").select("*").eq("deal_id", deal.id).order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      setTags(
        (tagsRes.data ?? [])
          .map((r: Record<string, unknown>) => r.tags as Tag)
          .filter(Boolean),
      );
      setStatuses((statusesRes.data ?? []) as ContactStatus[]);
      setLeadOrigins((originsRes.data ?? []) as LeadOrigin[]);
      setCustomFields((fieldsRes.data ?? []) as CustomField[]);
      const valueMap: Record<string, string> = {};
      for (const v of valuesRes.data ?? []) valueMap[v.custom_field_id] = v.value ?? "";
      setCustomValues(valueMap);
      setEvents((eventsRes.data ?? []) as DealEvent[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, deal?.id, deal?.contact_id, supabase]);

  const statusLabel = useMemo(
    () => statuses.find((s) => s.id === contact?.status_id)?.label ?? null,
    [statuses, contact?.status_id],
  );
  const statusColor = useMemo(
    () => statuses.find((s) => s.id === contact?.status_id)?.color ?? null,
    [statuses, contact?.status_id],
  );
  const leadOriginLabel = useMemo(
    () => leadOrigins.find((o) => o.id === contact?.lead_origin_id)?.label ?? null,
    [leadOrigins, contact?.lead_origin_id],
  );
  const leadOriginColor = useMemo(
    () => leadOrigins.find((o) => o.id === contact?.lead_origin_id)?.color ?? null,
    [leadOrigins, contact?.lead_origin_id],
  );

  async function handleMoveStage(stageId: string) {
    if (!deal || stageId === deal.stage_id) return;
    const previousStageId = deal.stage_id;
    setMovingStageId(stageId);
    const { error } = await supabase.from("deals").update({ stage_id: stageId }).eq("id", deal.id);
    setMovingStageId(null);
    if (error) {
      toast.error(t("moveStageFailed"));
      return;
    }
    fireAutomationTrigger("deal_stage_changed", deal.contact_id, {
      vars: { from_stage_id: previousStageId, to_stage_id: stageId },
    });
    onSaved();
  }

  // deal_events (migration 101) já loga 'assignee_changed' sozinho —
  // o trigger log_deal_event() dispara em QUALQUER UPDATE de deals
  // onde assigned_to mude, sem precisar de insert manual aqui.
  async function handleUpdateAssignee(profileId: string | null) {
    if (!deal) return;
    setUpdatingAssignee(true);
    const { error } = await supabase.from("deals").update({ assigned_to: profileId }).eq("id", deal.id);
    setUpdatingAssignee(false);
    if (error) {
      toast.error(t("updateAssigneeFailed"));
      return;
    }
    onSaved();
  }

  if (!deal) return null;

  const currency = deal.currency || defaultCurrency;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden border-border bg-popover p-0 text-popover-foreground",
          // Mobile: ficha em tela cheia (decisão 5) — sobrescreve o
          // posicionamento centralizado padrão do DialogContent.
          "top-0 left-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 rounded-none",
          // Desktop (sm+): modal centralizado largo. Precisa repetir o
          // prefixo sm: em CADA utilitário que colide com o default do
          // DialogContent (sm:max-w-sm, top-1/2, left-1/2, etc.) — o
          // twMerge só dedupe classes com o MESMO prefixo de variante,
          // então um max-w-5xl sem prefixo nunca vence um sm:max-w-sm
          // do componente base (bug original: painel abria a ~360px).
          "sm:top-1/2 sm:left-1/2 sm:h-[90vh] sm:w-[95vw] sm:max-w-[1400px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
        )}
      >
        {/* Topo — nome + barra de etapas */}
        <div className="border-b border-border/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="truncate text-base font-semibold text-foreground">{deal.title}</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEditFields(deal)}
              className="shrink-0 border-border text-muted-foreground hover:bg-muted"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("editFields")}
            </Button>
          </div>
          <div className="mt-3">
            <DealStageBar
              deal={deal}
              stages={stages}
              events={events}
              onMoveStage={handleMoveStage}
              moving={movingStageId}
              open={open}
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Esquerda — dados do lead e do negócio. Sempre visível em
              lg+; em telas menores vira a própria aba "Dados" (decisão
              5: celular em tela cheia com abas Dados/Conversa/Tarefas/
              Arquivos/Registros), escondida com `hidden` quando outra
              aba está ativa. */}
          <div
            className={cn(
              "w-full shrink-0 overflow-y-auto border-b border-border/50 p-4 lg:block lg:w-[380px] lg:border-b-0 lg:border-r",
              activeTab === "data" ? "block" : "hidden lg:block",
            )}
          >
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground">{contact?.name || contact?.phone || t("noContact")}</p>
                {contact?.phone && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {contact.phone}
                  </div>
                )}
                {contact?.email && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="h-3 w-3" />
                    {contact.email}
                  </div>
                )}
                {tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {CONTACT_STATUS_LEAD_ORIGIN_UI_ENABLED && statusLabel && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserCircle2 className="h-3.5 w-3.5" />
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: statusColor ?? undefined }} />
                  {statusLabel}
                </div>
              )}
              {CONTACT_STATUS_LEAD_ORIGIN_UI_ENABLED && leadOriginLabel && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Compass className="h-3.5 w-3.5" />
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: leadOriginColor ?? undefined }} />
                  {leadOriginLabel}
                </div>
              )}

              <div className="border-t border-border pt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">{tForm("valueLabel")}</span>
                  <span className="font-mono text-sm font-semibold text-primary">{formatCurrency(deal.value, currency)}</span>
                </div>
                {deal.expected_close_date && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    {t("forecast")}: {formatDate(deal.expected_close_date)}
                  </div>
                )}
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <User className="h-3.5 w-3.5 shrink-0" />
                  <select
                    value={deal.assigned_to ?? ""}
                    onChange={(e) => handleUpdateAssignee(e.target.value || null)}
                    disabled={updatingAssignee}
                    className="cursor-pointer border-none bg-transparent text-xs text-muted-foreground outline-none disabled:cursor-wait disabled:opacity-60"
                  >
                    <option value="">{tForm("unassigned")}</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || p.email}
                      </option>
                    ))}
                  </select>
                </div>
                {deal.stage_changed_at && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {t("stageTimeLabel")}{" "}
                    {t("daysCount", { count: calendarDaysSince(deal.stage_changed_at, timezone) })}
                  </div>
                )}
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {t("openTimeLabel")}{" "}
                  {t("daysCount", { count: calendarDaysSince(deal.created_at, timezone) })}
                </div>
              </div>

              {deal.notes && (
                <div className="border-t border-border pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{tForm("notesLabel")}</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">{deal.notes}</p>
                </div>
              )}

              {customFields.length > 0 && (
                <div className="border-t border-border pt-3 space-y-1.5">
                  {customFields
                    .filter((f) => customValues[f.id]?.trim())
                    .map((f) => (
                      <div key={f.id} className="flex justify-between gap-2 text-xs">
                        <span className="shrink-0 text-muted-foreground">{f.field_name}</span>
                        <span className="truncate text-right text-foreground">{customValues[f.id]}</span>
                      </div>
                    ))}
                </div>
              )}

              <div className="border-t border-border pt-3">
                <DealProductsEditor dealId={deal.id} currency={currency} />
              </div>

              <div className="border-t border-border pt-3">
                <DealWinLossActions deal={deal} onChanged={onSaved} />
              </div>

              <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">
                {t("createdOn", { date: formatDate(deal.created_at) })}
              </p>
            </div>
          </div>

          {/* Direita — abas. Em celular, "Dados" entra como 5ª aba
              (só visível <lg, decisão 5); em desktop a coluna da
              esquerda já está sempre visível, então o botão "Dados"
              fica escondido e nunca chega a ser clicado. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:min-w-0">
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/50 px-3 pt-2">
              {([
                { key: "data", label: t("tabData"), icon: Info, mobileOnly: true },
                { key: "conversation", label: t("tabConversation"), icon: MessageCircle, mobileOnly: false },
                { key: "tasks", label: t("tabTasks"), icon: CheckSquare, mobileOnly: false },
                { key: "files", label: t("tabFiles"), icon: FileText, mobileOnly: false },
                { key: "events", label: t("tabEvents"), icon: History, mobileOnly: false },
              ] as const).map(({ key, label, icon: Icon, mobileOnly }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                    mobileOnly && "lg:hidden",
                    activeTab === key
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Conversa — sem padding/scroll próprio: MessageThread já
                gerencia seu próprio layout e rolagem internamente
                (ScrollArea da lista de mensagens + composer fixo). */}
            {activeTab === "conversation" && (
              <div className="min-h-0 flex-1 overflow-hidden">
                <DealConversationTab contact={contact} />
              </div>
            )}

            {activeTab !== "conversation" && activeTab !== "data" && (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {activeTab === "tasks" && <DealTasksTab dealId={deal.id} profiles={profiles} />}
                {activeTab === "files" && <DealFilesTab contact={contact} />}
                {activeTab === "events" && (
                  <DealEventsTab events={events} stages={stages} profiles={profiles} currency={currency} />
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
