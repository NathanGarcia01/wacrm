"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { localeToDateFns, type Locale } from "@/i18n/locales";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type {
  Contact,
  Deal,
  DealStatus,
  ContactNote,
  Tag,
  CustomField,
  NpsSurvey,
  PipelineStage,
} from "@/types";
import { formatCurrency } from "@/lib/currency";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  Star,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { TagPickerPopover } from "./tag-picker-popover";
import { DealMiniSheet } from "./deal-mini-sheet";
import { DealForm } from "@/components/pipelines/deal-form";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Status badge styling for a deal — mirrors the Aberto/Ganho/Perdido
 *  convention used in the pipeline board and deal-form.tsx. */
function dealStatusBadge(
  status: DealStatus | undefined,
  t: (key: string) => string,
): { label: string; classes: string } {
  switch (status) {
    case "won":
      return {
        label: t("dealStatusWon"),
        // Explicit green — not bg-primary/text-primary, since the
        // account's accent theme can be violet/blue/amber/red
        // (globals.css) and "won" must always read as green.
        classes: "bg-green-500/10 text-green-400",
      };
    case "lost":
      return {
        label: t("dealStatusLost"),
        classes: "bg-red-500/10 text-red-400",
      };
    default:
      return {
        label: t("dealStatusOpen"),
        classes: "bg-blue-500/10 text-blue-400",
      };
  }
}

interface ContactSidebarProps {
  contact: Contact | null;
  /** Drives the SATISFAÇÃO section — NPS surveys are per-conversation,
   *  not per-contact, so this can't be derived from `contact`. */
  conversationId?: string | null;
  /** Fired after a direct field edit (name/phone/email/custom field)
   *  commits successfully, so the parent can keep its own copy of the
   *  contact (and any conversation list rows derived from it) in sync. */
  onContactUpdated?: (contact: Contact) => void;
}

export function ContactSidebar({ contact, conversationId, onContactUpdated }: ContactSidebarProps) {
  const t = useTranslations("inbox.sidebar");
  const locale = useLocale() as Locale;
  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [removingTagId, setRemovingTagId] = useState<string | null>(null);
  const [dealSheetOpen, setDealSheetOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  // Stages for the deal being edited's own pipeline — DealForm (the
  // same Sheet the pipeline board's edit action uses) needs the full
  // stage list up front rather than resolving it internally.
  const [editDealStages, setEditDealStages] = useState<PipelineStage[]>([]);
  const [npsSurvey, setNpsSurvey] = useState<NpsSurvey | null>(null);
  const [npsLoading, setNpsLoading] = useState(false);
  const [sendingNps, setSendingNps] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, tags, and custom fields/values in parallel
    const [dealsRes, notesRes, tagsRes, fieldsRes, valuesRes] = await Promise.all([
      supabase
        .from("deals")
        .select(
          "*, stage:pipeline_stages(*), assignee:profiles!deals_assigned_to_fkey(full_name), products:deal_products(id, name, value, quantity, commission_value)",
        )
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase.from("custom_fields").select("*").order("field_name"),
      supabase
        .from("contact_custom_values")
        .select("*")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
    if (fieldsRes.data) setCustomFields(fieldsRes.data as CustomField[]);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      for (const v of valuesRes.data) map[v.custom_field_id] = v.value ?? "";
      setCustomValues(map);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleUpdateField = useCallback(
    async (field: "name" | "phone" | "email", value: string) => {
      if (!contact) return;
      const supabase = createClient();
      const payload = { [field]: value || null, updated_at: new Date().toISOString() };
      const { error } = await supabase
        .from("contacts")
        .update(payload)
        .eq("id", contact.id);
      if (error) {
        toast.error(t("updateFailed"));
        throw error;
      }
      onContactUpdated?.({ ...contact, ...payload } as Contact);
    },
    [contact, onContactUpdated, t],
  );

  const handleCommitCustomField = useCallback(
    async (fieldId: string, value: string) => {
      if (!contact) return;
      const supabase = createClient();
      const trimmed = value.trim();
      if (!trimmed) {
        const { error } = await supabase
          .from("contact_custom_values")
          .delete()
          .eq("contact_id", contact.id)
          .eq("custom_field_id", fieldId);
        if (error) {
          toast.error(t("updateFailed"));
          throw error;
        }
      } else {
        const { error } = await supabase.from("contact_custom_values").upsert(
          { contact_id: contact.id, custom_field_id: fieldId, value: trimmed },
          { onConflict: "contact_id,custom_field_id" },
        );
        if (error) {
          toast.error(t("updateFailed"));
          throw error;
        }
      }
      setCustomValues((prev) => ({ ...prev, [fieldId]: trimmed }));
    },
    [contact, t],
  );

  const handleRemoveTag = useCallback(
    async (contactTagId: string) => {
      setRemovingTagId(contactTagId);
      const supabase = createClient();
      const { error } = await supabase
        .from("contact_tags")
        .delete()
        .eq("id", contactTagId);
      setRemovingTagId(null);
      if (error) return;
      fetchContactData();
    },
    [fetchContactData],
  );

  const handleAddDeal = useCallback(() => {
    setEditingDeal(null);
    setDealSheetOpen(true);
  }, []);

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDealSheetOpen(true);
  }, []);

  // Load the edited deal's own pipeline stages for DealForm. Only
  // relevant to the edit path (editingDeal set) — creating a new deal
  // still goes through DealMiniSheet, which resolves its own default
  // pipeline/stages internally.
  useEffect(() => {
    if (!dealSheetOpen || !editingDeal) {
      setEditDealStages([]);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", editingDeal.pipeline_id)
      .order("position", { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setEditDealStages((data ?? []) as PipelineStage[]);
      });
    return () => {
      cancelled = true;
    };
  }, [dealSheetOpen, editingDeal]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("contact_notes").delete().eq("id", noteId);
      if (error) {
        toast.error(t("deleteNoteFailed"));
        return;
      }
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    },
    [t],
  );

  const fetchNpsSurvey = useCallback(async () => {
    if (!conversationId) {
      setNpsSurvey(null);
      return;
    }
    setNpsLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("nps_surveys")
      .select("*")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    setNpsSurvey((data as NpsSurvey) ?? null);
    setNpsLoading(false);
  }, [conversationId]);

  useEffect(() => {
    fetchNpsSurvey();
  }, [fetchNpsSurvey]);

  const handleSendNpsNow = useCallback(async () => {
    if (!conversationId) return;
    setSendingNps(true);
    try {
      const res = await fetch("/api/nps/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error === "disabled" ? t("npsDisabled") : t("npsSendFailed"));
        return;
      }
      toast.success(t("npsSent"));
      fetchNpsSurvey();
    } finally {
      setSendingNps(false);
    }
  }, [conversationId, fetchNpsSurvey, t]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{t("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card-2 font-mono text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <div className="mt-3 w-full">
              <InlineEditField
                value={contact.name ?? ""}
                placeholder={t("namePlaceholder")}
                onCommit={(v) => handleUpdateField("name", v)}
                inputClassName="text-center text-sm font-semibold"
                displayClassName="justify-center text-sm font-semibold text-foreground"
              />
            </div>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-1">
            <div className="flex items-center gap-2 rounded-lg px-3 py-1 text-sm text-muted-foreground">
              <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
              <InlineEditField
                value={contact.phone}
                placeholder={t("phonePlaceholder")}
                type="tel"
                validate={(v) => (!v ? t("phoneRequired") : null)}
                onCommit={(v) => handleUpdateField("phone", v)}
                displayClassName="flex-1"
              />
              <button
                type="button"
                onClick={handleCopyPhone}
                aria-label={t("copyPhone")}
                className="shrink-0 rounded p-1 hover:bg-muted"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-lg px-3 py-1 text-sm text-muted-foreground">
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <InlineEditField
                value={contact.email ?? ""}
                placeholder={t("emailPlaceholder")}
                type="email"
                validate={(v) => (v && !EMAIL_RE.test(v) ? t("emailInvalid") : null)}
                onCommit={(v) => handleUpdateField("email", v)}
                displayClassName="flex-1"
              />
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {t("tags")}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {tags.map((tag) => (
                <span
                  key={tag.contact_tag_id}
                  className="group inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 text-[10px] font-medium"
                  style={{
                    backgroundColor: `${tag.color}20`,
                    color: tag.color,
                  }}
                >
                  {tag.name}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag.contact_tag_id)}
                    disabled={removingTagId === tag.contact_tag_id}
                    aria-label={t("removeTag", { name: tag.name })}
                    className="rounded-full p-0.5 opacity-60 transition-opacity hover:bg-black/10 hover:opacity-100 disabled:opacity-30 dark:hover:bg-white/10"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              <TagPickerPopover
                contactId={contact.id}
                existingTagIds={tags.map((t) => t.id)}
                onChanged={fetchContactData}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <DollarSign className="h-3 w-3" />
                {t("activeDeals")}
              </div>
              <button
                type="button"
                onClick={handleAddDeal}
                aria-label={t("newDeal")}
                className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{t("noDeals")}</p>
              ) : (
                deals.map((deal) => {
                  const statusBadge = dealStatusBadge(deal.status, t);
                  const dealCommissionTotal = (deal.products ?? []).reduce(
                    (sum, p) => sum + (p.commission_value ?? 0),
                    0,
                  );
                  return (
                    <div
                      key={deal.id}
                      className="group rounded-lg bg-muted px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {deal.title}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleEditDeal(deal)}
                          aria-label={t("editDeal", { title: deal.title })}
                          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-black/10 hover:text-foreground group-hover:opacity-100 dark:hover:bg-white/10"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold text-foreground">
                            {formatCurrency(deal.value, deal.currency)}
                          </span>
                          {dealCommissionTotal > 0 && (
                            <span
                              className="font-mono text-xs font-medium text-gold"
                              title={t("dealCommissionTotal")}
                            >
                              +{formatCurrency(dealCommissionTotal, deal.currency)}
                            </span>
                          )}
                        </span>
                        {deal.stage && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[10px]"
                            style={{
                              backgroundColor: `${deal.stage.color}20`,
                              color: deal.stage.color,
                            }}
                          >
                            {deal.stage.name}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>
                          {deal.assignee?.full_name
                            ? t("dealAssignedTo", { name: deal.assignee.full_name })
                            : t("dealUnassigned")}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusBadge.classes}`}
                        >
                          {statusBadge.label}
                        </span>
                      </div>
                      {deal.expected_close_date && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t("dealCloseDate", {
                            date: format(
                              new Date(`${deal.expected_close_date}T00:00:00`),
                              "dd/MM/yyyy",
                            ),
                          })}
                        </p>
                      )}
                      {deal.products && deal.products.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {deal.products.map((product) => (
                            <p
                              key={product.id}
                              className="truncate text-[11px] text-muted-foreground"
                              title={`${product.name} — ${formatCurrency(product.value * product.quantity, deal.currency)}`}
                            >
                              {product.name} —{" "}
                              {formatCurrency(product.value * product.quantity, deal.currency)}
                            </p>
                          ))}
                        </div>
                      )}
                      {deal.notes && (
                        <p
                          className="mt-1 truncate text-[11px] text-muted-foreground italic"
                          title={deal.notes}
                        >
                          {deal.notes}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Satisfaction (NPS) */}
          {conversationId && (
            <>
              <div>
                <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Star className="h-3 w-3" />
                  {t("satisfaction")}
                </div>
                <div className="mt-2">
                  {npsLoading ? (
                    <div className="flex justify-center py-2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : !npsSurvey ? (
                    <button
                      type="button"
                      onClick={handleSendNpsNow}
                      disabled={sendingNps}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/70 disabled:opacity-50"
                    >
                      {sendingNps ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      {t("sendNpsNow")}
                    </button>
                  ) : (
                    <div className="space-y-1.5 rounded-lg bg-muted px-3 py-2">
                      {npsSurvey.rating == null ? (
                        <p className="text-xs text-muted-foreground">
                          {npsSurvey.status === "expired"
                            ? t("npsExpired")
                            : t("npsAwaitingRating")}
                        </p>
                      ) : (
                        <>
                          <div className="flex items-center gap-0.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                className={
                                  i < (npsSurvey.rating ?? 0)
                                    ? "h-3.5 w-3.5 fill-amber-400 text-amber-400"
                                    : "h-3.5 w-3.5 text-muted-foreground/30"
                                }
                              />
                            ))}
                          </div>
                          {npsSurvey.comment ? (
                            <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                              {npsSurvey.comment}
                            </p>
                          ) : npsSurvey.status === "sent" ? (
                            <p className="text-xs text-muted-foreground">
                              {t("npsAwaitingComment")}
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="my-4 border-t border-border" />
            </>
          )}

          {/* Custom fields */}
          {customFields.length > 0 && (
            <>
              <div>
                <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("customFields")}
                </div>
                <div className="mt-2 space-y-1">
                  {customFields.map((field) => (
                    <div
                      key={field.id}
                      className="flex items-center gap-2 rounded-lg px-3 py-1 text-sm text-muted-foreground"
                    >
                      <span className="w-20 shrink-0 truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                        {field.field_name}
                      </span>
                      <InlineEditField
                        value={customValues[field.id] ?? ""}
                        placeholder={t("enterFieldPlaceholder", { field: field.field_name })}
                        onCommit={(v) => handleCommitCustomField(field.id, v)}
                        displayClassName="flex-1"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="my-4 border-t border-border" />
            </>
          )}

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {t("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={t("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="group rounded-lg bg-muted px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                        {note.note_text}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleDeleteNote(note.id)}
                        aria-label={t("deleteNote")}
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm", {
                        locale: localeToDateFns(locale),
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {editingDeal ? (
        // Editing an existing deal opens the same Sheet the pipeline
        // board's edit action uses (full editor: contact, currency,
        // notes, close date, products, won/lost) — not the narrower
        // DealMiniSheet below, which stays reserved for quick-creating
        // a new deal mid-conversation.
        <DealForm
          open={dealSheetOpen}
          onOpenChange={setDealSheetOpen}
          deal={editingDeal}
          pipelineId={editingDeal.pipeline_id}
          stages={editDealStages}
          onSaved={fetchContactData}
        />
      ) : (
        <DealMiniSheet
          open={dealSheetOpen}
          onOpenChange={setDealSheetOpen}
          deal={null}
          contactId={contact.id}
          onSaved={fetchContactData}
        />
      )}
    </div>
  );
}

interface InlineEditFieldProps {
  value: string;
  placeholder?: string;
  type?: "text" | "email" | "tel";
  /** Return an error message to block the commit, or null/undefined to allow it. */
  validate?: (value: string) => string | null | undefined;
  /** Persist the new value. Throw (or reject) to keep the field in edit mode. */
  onCommit: (value: string) => Promise<void>;
  displayClassName?: string;
  inputClassName?: string;
}

/**
 * Click-to-edit text field used throughout the sidebar for contact
 * attributes. Enter/blur commits, Escape reverts. `status` drives the
 * "Salvando…" / "Salvo ✓" affordance the task spec calls for.
 */
function InlineEditField({
  value,
  placeholder,
  type = "text",
  validate,
  onCommit,
  displayClassName,
  inputClassName,
}: InlineEditFieldProps) {
  const t = useTranslations("inbox.sidebar");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Keep the draft in sync when the underlying value changes elsewhere
  // (e.g. another tab updates the contact) while this field isn't being
  // edited — a legitimate prop-driven sync, not a fetch side effect.
  useEffect(() => {
    if (!editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(value);
    }
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    return () => clearTimeout(savedTimeoutRef.current);
  }, []);

  const startEdit = useCallback(() => {
    setDraft(value);
    setEditing(true);
  }, [value]);

  const cancel = useCallback(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  const commit = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === (value ?? "").trim()) {
      setEditing(false);
      return;
    }
    const error = validate?.(trimmed);
    if (error) {
      toast.error(error);
      return;
    }
    setStatus("saving");
    try {
      await onCommit(trimmed);
      setEditing(false);
      setStatus("saved");
      savedTimeoutRef.current = setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("idle");
    }
  }, [draft, value, validate, onCommit]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-md border border-primary/50 bg-muted px-2 py-1 text-sm text-foreground outline-none",
          inputClassName,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      className={cn(
        "group/field flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-muted",
        displayClassName,
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {value || <span className="text-muted-foreground">{placeholder}</span>}
      </span>
      {status === "saving" && (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("saving")}
        </span>
      )}
      {status === "saved" && (
        <span className="shrink-0 text-[10px] text-primary">{t("saved")}</span>
      )}
      {status === "idle" && (
        <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/field:opacity-100" />
      )}
    </button>
  );
}
