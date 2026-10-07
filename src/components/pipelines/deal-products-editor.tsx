"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import type { DealProduct, ProductCatalogItem } from "@/types";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Check, X, Trash2, Loader2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

interface ProductDraft {
  name: string;
  value: string;
  quantity: string;
  commissionRate: string;
}

const EMPTY_DRAFT: ProductDraft = { name: "", value: "", quantity: "1", commissionRate: "" };

function computeCommission(value: string, quantity: string, commissionRate: string): number {
  const v = parseFloat(value) || 0;
  const q = parseInt(quantity, 10) || 1;
  const rate = parseFloat(commissionRate) || 0;
  return (v * q * rate) / 100;
}

/**
 * Fase 6 (negócio com conversa embutida), Etapa 1 — editor de
 * produtos do negócio, extraído em espírito de deal-form.tsx's
 * products block (que só renderizava com `deal &&` — e o Sheet de
 * deal-form.tsx agora só serve pra CRIAR negócio, então aquele bloco
 * ficou inalcançável). Reescrito aqui como componente próprio, em vez
 * de uma extração mecânica, pra não arrastar o estado do formulário
 * inteiro. Mesma persistência: `deal_products` (migration 030) +
 * sincroniza `deals.value` com a soma a cada mudança — aqui direto,
 * sem esperar um "Salvar" de formulário, já que não existe um aqui.
 */
export function DealProductsEditor({
  dealId,
  currency,
  onTotalChanged,
}: {
  dealId: string;
  currency: string;
  /** Fired after any add/edit/delete that changes the total, with the
   *  new sum — so the parent panel can update its own displayed value
   *  without refetching the whole deal. */
  onTotalChanged?: (total: number) => void;
}) {
  const t = useTranslations("pipelines.dealForm");
  const supabase = createClient();
  const { accountId } = useAuth();

  const [products, setProducts] = useState<DealProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<ProductCatalogItem[]>([]);

  const [adding, setAdding] = useState(false);
  const [newProduct, setNewProduct] = useState<ProductDraft>(EMPTY_DRAFT);
  const [savingNew, setSavingNew] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const total = products.reduce((sum, p) => sum + p.value * p.quantity, 0);
  const commissionTotal = products.reduce((sum, p) => sum + (p.commission_value ?? 0), 0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("deal_products")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      setProducts((data ?? []) as DealProduct[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId, supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("product_catalog")
        .select("*")
        .order("name");
      if (!cancelled) setCatalog((data ?? []) as ProductCatalogItem[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function syncDealValue(newTotal: number) {
    await supabase.from("deals").update({ value: newTotal }).eq("id", dealId);
    onTotalChanged?.(newTotal);
  }

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

  async function handleAddProduct() {
    if (!accountId || !newProduct.name.trim()) return;
    setSavingNew(true);
    const parsedValue = parseFloat(newProduct.value) || 0;
    const parsedQuantity = parseInt(newProduct.quantity, 10) || 1;
    const parsedRate = parseFloat(newProduct.commissionRate) || 0;
    const { data, error } = await supabase
      .from("deal_products")
      .insert({
        deal_id: dealId,
        account_id: accountId,
        name: newProduct.name.trim(),
        value: parsedValue,
        quantity: parsedQuantity,
        commission_rate: parsedRate,
        commission_value: computeCommission(newProduct.value, newProduct.quantity, newProduct.commissionRate),
      })
      .select()
      .single();
    setSavingNew(false);
    if (error || !data) {
      toast.error(t("productSaveFailed"));
      return;
    }
    const next = [...products, data as DealProduct];
    setProducts(next);
    setNewProduct(EMPTY_DRAFT);
    setAdding(false);
    await syncDealValue(next.reduce((sum, p) => sum + p.value * p.quantity, 0));
  }

  function startEdit(product: DealProduct) {
    setEditingId(product.id);
    setEditDraft({
      name: product.name,
      value: String(product.value),
      quantity: String(product.quantity),
      commissionRate: product.commission_rate ? String(product.commission_rate) : "",
    });
  }

  async function handleSaveEdit(productId: string) {
    if (!editDraft.name.trim()) return;
    setSavingId(productId);
    const parsedValue = parseFloat(editDraft.value) || 0;
    const parsedQuantity = parseInt(editDraft.quantity, 10) || 1;
    const parsedRate = parseFloat(editDraft.commissionRate) || 0;
    const commissionValue = computeCommission(editDraft.value, editDraft.quantity, editDraft.commissionRate);
    const { error } = await supabase
      .from("deal_products")
      .update({
        name: editDraft.name.trim(),
        value: parsedValue,
        quantity: parsedQuantity,
        commission_rate: parsedRate,
        commission_value: commissionValue,
      })
      .eq("id", productId);
    setSavingId(null);
    if (error) {
      toast.error(t("productSaveFailed"));
      return;
    }
    const next = products.map((p) =>
      p.id === productId
        ? { ...p, name: editDraft.name.trim(), value: parsedValue, quantity: parsedQuantity, commission_rate: parsedRate, commission_value: commissionValue }
        : p,
    );
    setProducts(next);
    setEditingId(null);
    await syncDealValue(next.reduce((sum, p) => sum + p.value * p.quantity, 0));
  }

  async function handleDelete(productId: string) {
    setDeletingId(productId);
    const { error } = await supabase.from("deal_products").delete().eq("id", productId);
    setDeletingId(null);
    if (error) {
      toast.error(t("productDeleteFailed"));
      return;
    }
    const next = products.filter((p) => p.id !== productId);
    setProducts(next);
    await syncDealValue(next.reduce((sum, p) => sum + p.value * p.quantity, 0));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("productsLabel")}
        </span>
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label={t("addProduct")}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : products.length === 0 && !adding ? (
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
                  <TableHead className="w-16 text-muted-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) =>
                  editingId === product.id ? (
                    <TableRow key={product.id} className="border-border">
                      <TableCell>
                        <Input
                          value={editDraft.name}
                          onChange={(e) => setEditDraft((prev) => ({ ...prev, name: e.target.value }))}
                          className="h-7 border-border bg-muted text-xs text-foreground"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={editDraft.value}
                          onChange={(e) => setEditDraft((prev) => ({ ...prev, value: e.target.value }))}
                          className="h-7 w-20 border-border bg-muted text-xs text-foreground"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          value={editDraft.quantity}
                          onChange={(e) => setEditDraft((prev) => ({ ...prev, quantity: e.target.value }))}
                          className="h-7 w-16 border-border bg-muted text-xs text-foreground"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.1"
                          value={editDraft.commissionRate}
                          onChange={(e) => setEditDraft((prev) => ({ ...prev, commissionRate: e.target.value }))}
                          placeholder="0"
                          className="h-7 w-16 border-border bg-muted text-xs text-foreground"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-foreground">
                        {formatCurrency(
                          (parseFloat(editDraft.value) || 0) * (parseInt(editDraft.quantity, 10) || 1),
                          currency,
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(product.id)}
                            disabled={savingId === product.id}
                            className="rounded p-1 text-primary hover:bg-muted"
                          >
                            {savingId === product.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
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
                      <TableCell className="font-mono text-xs text-foreground">
                        {formatCurrency(product.value, currency)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-foreground">{product.quantity}</TableCell>
                      <TableCell className="font-mono text-xs text-foreground">
                        {product.commission_rate ? `${product.commission_rate}%` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-foreground">
                        {formatCurrency(product.value * product.quantity, currency)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => startEdit(product)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(product.id)}
                            disabled={deletingId === product.id}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                          >
                            {deletingId === product.id ? (
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
                {adding && (
                  <TableRow className="border-border">
                    <TableCell>
                      {catalog.length > 0 ? (
                        <select
                          onChange={(e) => (e.target.value ? applyCatalogItem(e.target.value) : undefined)}
                          className="h-7 w-full rounded border border-border bg-muted px-1 text-xs text-foreground"
                          defaultValue=""
                        >
                          <option value="">{t("productNamePlaceholder")}</option>
                          {catalog.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <Input
                        value={newProduct.name}
                        onChange={(e) => setNewProduct((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder={t("productNamePlaceholder")}
                        className="mt-1 h-7 border-border bg-muted text-xs text-foreground"
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
                        onChange={(e) => setNewProduct((prev) => ({ ...prev, commissionRate: e.target.value }))}
                        placeholder="0"
                        className="h-7 w-16 border-border bg-muted text-xs text-foreground"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">
                      {formatCurrency(
                        (parseFloat(newProduct.value) || 0) * (parseInt(newProduct.quantity, 10) || 1),
                        currency,
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={handleAddProduct}
                          disabled={savingNew || !newProduct.name.trim()}
                          className="rounded p-1 text-primary hover:bg-muted"
                        >
                          {savingNew ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAdding(false);
                            setNewProduct(EMPTY_DRAFT);
                          }}
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
        </div>
      )}

      {products.length > 0 && (
        <div className="flex items-center justify-end gap-3 px-1 text-xs">
          <span className="text-muted-foreground">
            {t("productTotalLabel")}: <span className="font-mono font-semibold text-foreground">{formatCurrency(total, currency)}</span>
          </span>
          {commissionTotal > 0 && (
            <span className="text-muted-foreground" title={t("commissionTotalLabel")}>
              <span className="font-mono font-semibold text-gold">+{formatCurrency(commissionTotal, currency)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
