"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type {
  Contact,
  Conversation,
  Deal,
  DealProduct,
  DealStatus,
  PipelineStage,
  ProductCatalogItem,
  Profile,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  DollarSign,
  Loader2,
  Plus,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { fireAutomationTrigger } from "@/lib/automations/client-dispatch";

const LOST_REASON_CHIPS = [
  "priceTooHigh",
  "choseCompetitor",
  "noInterest",
  "noContact",
  "other",
] as const;

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations("pipelines.dealForm");
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [products, setProducts] = useState<DealProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    value: "",
    quantity: "1",
    commissionRate: "",
  });
  const [savingNewProduct, setSavingNewProduct] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editProductDraft, setEditProductDraft] = useState({
    name: "",
    value: "",
    quantity: "1",
    commissionRate: "",
  });
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);

  // Pre-registered products (Settings → Produtos) an agent can pick from
  // instead of typing name/value/commission from scratch — see #7.
  const [catalog, setCatalog] = useState<ProductCatalogItem[]>([]);

  const [lostReasonOpen, setLostReasonOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [savingLostReason, setSavingLostReason] = useState(false);

  const productsTotal = products.reduce((sum, p) => sum + p.value * p.quantity, 0);
  const commissionTotal = products.reduce((sum, p) => sum + (p.commission_value ?? 0), 0);

  function computeCommission(value: string, quantity: string, commissionRate: string): number {
    const v = parseFloat(value) || 0;
    const q = parseInt(quantity, 10) || 1;
    const rate = parseFloat(commissionRate) || 0;
    return (v * q * rate) / 100;
  }

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (deal) {
      setTitle(deal.title);
      setValue(String(deal.value ?? ""));
      setCurrency(deal.currency || defaultCurrency);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? "");
      setExpectedCloseDate(deal.expected_close_date ?? "");
      setNotes(deal.notes ?? "");
    } else {
      setTitle("");
      setValue("");
      setCurrency(defaultCurrency);
      setContactId("");
      setStageId(defaultStageId || stages[0]?.id || "");
      setAssignedTo("");
      setExpectedCloseDate("");
      setNotes("");
    }
  }, [open, deal, defaultStageId, stages, defaultCurrency]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p, cat] = await Promise.all([
        supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
        supabase
          .from("product_catalog")
          .select("*")
          .eq("is_active", true)
          .order("name"),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
      setCatalog((cat.data ?? []) as ProductCatalogItem[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // Fetch linked conversation for the selected contact (newest open one).
  // Clearing on no-selection is sync with prop state; the populated
  // case runs setLinkedConversation inside the async fetch callback.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  // Line items for the deal. Only fetchable once the deal exists — a
  // deal being created has no id yet, so the section renders empty
  // (guarded by `deal &&` below) until the first save.
  useEffect(() => {
    if (!open || !deal) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProducts([]);
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingProducts(true);
    (async () => {
      const { data } = await supabase
        .from("deal_products")
        .select("*")
        .eq("deal_id", deal.id)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      setProducts((data ?? []) as DealProduct[]);
      setLoadingProducts(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, deal, supabase]);

  // #1 — the deal's value is driven by its line items once any exist:
  // the user no longer types it manually. Recomputes on every products
  // change (add/edit/delete/initial load). A deal with no products
  // keeps whatever value was typed in directly.
  useEffect(() => {
    if (products.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(String(productsTotal));
    }
  }, [productsTotal, products.length]);

  async function handleAddProduct() {
    if (!deal || !accountId || !newProduct.name.trim()) return;
    setSavingNewProduct(true);
    const parsedValue = parseFloat(newProduct.value) || 0;
    const parsedQuantity = parseInt(newProduct.quantity, 10) || 1;
    const parsedRate = parseFloat(newProduct.commissionRate) || 0;
    const { data, error } = await supabase
      .from("deal_products")
      .insert({
        deal_id: deal.id,
        account_id: accountId,
        name: newProduct.name.trim(),
        value: parsedValue,
        quantity: parsedQuantity,
        commission_rate: parsedRate,
        commission_value: computeCommission(newProduct.value, newProduct.quantity, newProduct.commissionRate),
      })
      .select()
      .single();
    setSavingNewProduct(false);
    if (error || !data) {
      toast.error(t("productSaveFailed"));
      return;
    }
    setProducts((prev) => [...prev, data as DealProduct]);
    setNewProduct({ name: "", value: "", quantity: "1", commissionRate: "" });
    setAddingProduct(false);
  }

  function startEditProduct(product: DealProduct) {
    setEditingProductId(product.id);
    setEditProductDraft({
      name: product.name,
      value: String(product.value),
      quantity: String(product.quantity),
      commissionRate: product.commission_rate ? String(product.commission_rate) : "",
    });
  }

  async function handleSaveProduct(productId: string) {
    if (!editProductDraft.name.trim()) return;
    setSavingProductId(productId);
    const parsedValue = parseFloat(editProductDraft.value) || 0;
    const parsedQuantity = parseInt(editProductDraft.quantity, 10) || 1;
    const parsedRate = parseFloat(editProductDraft.commissionRate) || 0;
    const commissionValue = computeCommission(
      editProductDraft.value,
      editProductDraft.quantity,
      editProductDraft.commissionRate,
    );
    const { error } = await supabase
      .from("deal_products")
      .update({
        name: editProductDraft.name.trim(),
        value: parsedValue,
        quantity: parsedQuantity,
        commission_rate: parsedRate,
        commission_value: commissionValue,
      })
      .eq("id", productId);
    setSavingProductId(null);
    if (error) {
      toast.error(t("productSaveFailed"));
      return;
    }
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId
          ? {
              ...p,
              name: editProductDraft.name.trim(),
              value: parsedValue,
              quantity: parsedQuantity,
              commission_rate: parsedRate,
              commission_value: commissionValue,
            }
          : p,
      ),
    );
    setEditingProductId(null);
  }

  /** #7 — picking a catalog item pre-fills name/value/commission; the
   *  agent can still adjust any of them before saving. */
  function applyCatalogItem(catalogId: string) {
    const item = catalog.find((c) => c.id === catalogId);
    if (!item) return;
    setNewProduct((prev) => ({
      ...prev,
      name: item.name,
      value: String(item.default_value),
      commissionRate: item.default_commission_rate ? String(item.default_commission_rate) : "",
    }));
  }

  async function handleDeleteProduct(productId: string) {
    setDeletingProductId(productId);
    const { error } = await supabase.from("deal_products").delete().eq("id", productId);
    setDeletingProductId(null);
    if (error) {
      toast.error(t("productDeleteFailed"));
      return;
    }
    setProducts((prev) => prev.filter((p) => p.id !== productId));
  }

  function handleReasonChip(key: (typeof LOST_REASON_CHIPS)[number]) {
    if (key === "other") {
      setLostReason("");
      return;
    }
    setLostReason(t(`lostReasonChips.${key}`));
  }

  async function confirmMarkLost() {
    if (!deal || !lostReason.trim()) return;
    setSavingLostReason(true);
    const { error } = await supabase
      .from("deals")
      .update({ status: "lost", lost_reason: lostReason.trim() })
      .eq("id", deal.id);
    setSavingLostReason(false);
    if (error) {
      toast.error(t("updateStatusFailed"));
      return;
    }
    fireAutomationTrigger("deal_lost", contactId, { vars: { reason: lostReason.trim() } });
    toast.success(t("markedAsLost"));
    setLostReasonOpen(false);
    onOpenChange(false);
    onSaved();
  }

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error(t("titleContactStageRequired"));
      return;
    }
    setSaving(true);

    const payload = {
      title: title.trim(),
      value: parseFloat(value) || 0,
      currency,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: notes.trim() || null,
      expected_close_date: expectedCloseDate || null,
    };

    if (deal) {
      const previousStageId = deal.stage_id;
      const { error } = await supabase
        .from("deals")
        .update(payload)
        .eq("id", deal.id);
      if (error) {
        toast.error(t("saveFailed"));
        setSaving(false);
        return;
      }
      if (previousStageId !== stageId) {
        fireAutomationTrigger("deal_stage_changed", contactId, {
          vars: { from_stage_id: previousStageId, to_stage_id: stageId },
        });
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error(t("notSignedIn"));
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error(t("noAccountLinked"));
        setSaving(false);
        return;
      }
      const { error } = await supabase
        .from("deals")
        .insert({ ...payload, user_id: user.id, account_id: accountId, status: "open" });
      if (error) {
        toast.error(t("createFailed"));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast.success(deal ? t("dealUpdated") : t("dealCreated"));
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;
    setStatusAction(status);
    const { error } = await supabase
      .from("deals")
      .update({ status })
      .eq("id", deal.id);
    setStatusAction(null);
    if (error) {
      toast.error(t("updateStatusFailed"));
      return;
    }
    if (status === "won") {
      fireAutomationTrigger("deal_won", contactId);
    }
    toast.success(
      status === "won" ? t("markedAsWon") : status === "lost" ? t("markedAsLost") : t("dealReopened"),
    );
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error(t("deleteFailed"));
      return;
    }
    toast.success(t("dealDeleted"));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-2xl w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? t("editDeal") : t("newDeal")}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("titleLabel")}</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("contactLabel")}</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">{t("selectContact")}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>

              {linkedConversation && (
                <Link
                  href="/inbox"
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                >
                  <MessageSquare className="h-3 w-3" />
                  {t("linkToConversation")}
                </Link>
              )}
            </div>

            <div className="grid grid-cols-[1fr_110px] gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("valueLabel")}</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="0"
                    readOnly={products.length > 0}
                    disabled={products.length > 0}
                    className={cn(
                      "border-border bg-muted pl-7 text-foreground",
                      products.length > 0 && "cursor-not-allowed opacity-70",
                    )}
                  />
                </div>
                {products.length > 0 && (
                  <p className="text-xs text-muted-foreground">{t("valueFromProductsHint")}</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("currencyLabel")}</Label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("expectedCloseDateLabel")}</Label>
              <Input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("stageLabel")}</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("assignedToLabel")}</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">{t("unassigned")}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("notesLabel")}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("notesPlaceholder")}
                className="min-h-[100px] border-border bg-muted text-foreground"
              />
            </div>

            {deal && (
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-muted-foreground">{t("productsLabel")}</Label>
                  <button
                    type="button"
                    onClick={() => setAddingProduct(true)}
                    aria-label={t("addProduct")}
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                {loadingProducts ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : products.length === 0 && !addingProduct ? (
                  <p className="text-xs text-muted-foreground">{t("noProducts")}</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border hover:bg-transparent">
                            <TableHead className="text-muted-foreground">{t("productNameLabel")}</TableHead>
                            <TableHead className="text-muted-foreground">{t("productValueLabel")}</TableHead>
                            <TableHead className="text-muted-foreground">{t("productQuantityLabel")}</TableHead>
                            <TableHead className="text-muted-foreground">{t("productCommissionRateLabel")}</TableHead>
                            <TableHead className="text-muted-foreground">{t("productTotalLabel")}</TableHead>
                            <TableHead className="text-muted-foreground">{t("productCommissionLabel")}</TableHead>
                            <TableHead className="w-16 text-muted-foreground" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {products.map((product) =>
                            editingProductId === product.id ? (
                              <TableRow key={product.id} className="border-border">
                                <TableCell>
                                  <Input
                                    value={editProductDraft.name}
                                    onChange={(e) =>
                                      setEditProductDraft((prev) => ({ ...prev, name: e.target.value }))
                                    }
                                    className="h-7 border-border bg-muted text-xs text-foreground"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    value={editProductDraft.value}
                                    onChange={(e) =>
                                      setEditProductDraft((prev) => ({ ...prev, value: e.target.value }))
                                    }
                                    className="h-7 w-20 border-border bg-muted text-xs text-foreground"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    min={1}
                                    value={editProductDraft.quantity}
                                    onChange={(e) =>
                                      setEditProductDraft((prev) => ({ ...prev, quantity: e.target.value }))
                                    }
                                    className="h-7 w-16 border-border bg-muted text-xs text-foreground"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={editProductDraft.commissionRate}
                                    onChange={(e) =>
                                      setEditProductDraft((prev) => ({ ...prev, commissionRate: e.target.value }))
                                    }
                                    placeholder="0"
                                    className="h-7 w-16 border-border bg-muted text-xs text-foreground"
                                  />
                                </TableCell>
                                <TableCell className="text-xs text-foreground">
                                  {(
                                    (parseFloat(editProductDraft.value) || 0) *
                                    (parseInt(editProductDraft.quantity, 10) || 1)
                                  ).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-xs font-medium text-green-500">
                                  {computeCommission(
                                    editProductDraft.value,
                                    editProductDraft.quantity,
                                    editProductDraft.commissionRate,
                                  ).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleSaveProduct(product.id)}
                                      disabled={savingProductId === product.id || !editProductDraft.name.trim()}
                                      aria-label={t("saveProduct")}
                                      className="rounded p-1 text-primary hover:bg-primary/10 disabled:opacity-50"
                                    >
                                      {savingProductId === product.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Check className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingProductId(null)}
                                      aria-label={t("cancel")}
                                      className="rounded p-1 text-muted-foreground hover:bg-muted"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : (
                              <TableRow key={product.id} className="group border-border">
                                <TableCell className="text-xs text-foreground">{product.name}</TableCell>
                                <TableCell className="text-xs text-foreground">{product.value.toLocaleString()}</TableCell>
                                <TableCell className="text-xs text-foreground">{product.quantity}</TableCell>
                                <TableCell className="text-xs text-foreground">
                                  {product.commission_rate ? `${product.commission_rate}%` : "—"}
                                </TableCell>
                                <TableCell className="text-xs font-medium text-foreground">
                                  {(product.value * product.quantity).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-xs font-medium text-green-500">
                                  {(product.commission_value ?? 0).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                    <button
                                      type="button"
                                      onClick={() => startEditProduct(product)}
                                      aria-label={t("editProduct")}
                                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteProduct(product.id)}
                                      disabled={deletingProductId === product.id}
                                      aria-label={t("deleteProduct")}
                                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-400 disabled:opacity-50"
                                    >
                                      {deletingProductId === product.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ),
                          )}

                          {addingProduct && (
                            <TableRow className="border-border">
                              <TableCell>
                                <Input
                                  autoFocus
                                  value={newProduct.name}
                                  onChange={(e) => setNewProduct((prev) => ({ ...prev, name: e.target.value }))}
                                  placeholder={t("productNamePlaceholder")}
                                  className="h-7 border-border bg-muted text-xs text-foreground"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={newProduct.value}
                                  onChange={(e) => setNewProduct((prev) => ({ ...prev, value: e.target.value }))}
                                  placeholder="0"
                                  className="h-7 w-20 border-border bg-muted text-xs text-foreground"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min={1}
                                  value={newProduct.quantity}
                                  onChange={(e) => setNewProduct((prev) => ({ ...prev, quantity: e.target.value }))}
                                  className="h-7 w-16 border-border bg-muted text-xs text-foreground"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  step="0.1"
                                  value={newProduct.commissionRate}
                                  onChange={(e) =>
                                    setNewProduct((prev) => ({ ...prev, commissionRate: e.target.value }))
                                  }
                                  placeholder="0"
                                  className="h-7 w-16 border-border bg-muted text-xs text-foreground"
                                />
                              </TableCell>
                              <TableCell className="text-xs text-foreground">
                                {(
                                  (parseFloat(newProduct.value) || 0) * (parseInt(newProduct.quantity, 10) || 1)
                                ).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-xs font-medium text-green-500">
                                {computeCommission(
                                  newProduct.value,
                                  newProduct.quantity,
                                  newProduct.commissionRate,
                                ).toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={handleAddProduct}
                                    disabled={savingNewProduct || !newProduct.name.trim()}
                                    aria-label={t("saveProduct")}
                                    className="rounded p-1 text-primary hover:bg-primary/10 disabled:opacity-50"
                                  >
                                    {savingNewProduct ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Check className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAddingProduct(false);
                                      setNewProduct({ name: "", value: "", quantity: "1", commissionRate: "" });
                                    }}
                                    aria-label={t("cancel")}
                                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    {products.length > 0 && (
                      <div className="space-y-1 border-t border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-foreground">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">{t("productsTotalLabel")}</span>
                          <span>{productsTotal.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">{t("commissionTotalLabel")}</span>
                          <span className="text-green-500">{commissionTotal.toLocaleString()}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {addingProduct && catalog.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Label className="shrink-0 text-xs text-muted-foreground">
                      {t("chooseFromCatalog")}
                    </Label>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) applyCatalogItem(e.target.value);
                      }}
                      className="h-8 flex-1 rounded-lg border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
                    >
                      <option value="">{t("chooseFromCatalogPlaceholder")}</option>
                      {catalog.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {deal && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("statusLabel")}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("won")}
                    disabled={!!statusAction || deal.status === "won"}
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {statusAction === "won" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        {t("markAsWon")}
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setLostReason("");
                      setLostReasonOpen(true);
                    }}
                    disabled={!!statusAction || deal.status === "lost"}
                    className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    <X className="mr-1 h-4 w-4" />
                    {t("markAsLost")}
                  </Button>
                </div>
                {deal.status === "lost" && deal.lost_reason && (
                  <p className="text-xs text-muted-foreground">
                    {t("lostReasonLabel")}: {deal.lost_reason}
                  </p>
                )}
                {deal.status && deal.status !== "open" && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleStatusChange("open")}
                    disabled={!!statusAction}
                    className="w-full text-muted-foreground hover:text-foreground"
                  >
                    {t("reopenDeal")}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !title.trim() || !contactId || !stageId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : deal ? t("saveChanges") : t("createDeal")}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">{t("confirmDeleteDeal")}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? t("deleting") : t("confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  {t("deleteDeal")}
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>

      <Dialog open={lostReasonOpen} onOpenChange={setLostReasonOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("lostReasonTitle")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {LOST_REASON_CHIPS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleReasonChip(key)}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {t(`lostReasonChips.${key}`)}
                </button>
              ))}
            </div>
            <Textarea
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder={t("lostReasonPlaceholder")}
              className="min-h-[90px] border-border bg-muted text-foreground"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLostReasonOpen(false)}
              disabled={savingLostReason}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              onClick={confirmMarkLost}
              disabled={savingLostReason || !lostReason.trim()}
              className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {savingLostReason ? <Loader2 className="h-4 w-4 animate-spin" /> : t("markAsLost")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
