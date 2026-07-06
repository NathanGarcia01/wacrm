'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Package, Pencil, Plus, Shield, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import type { ProductCatalogItem } from '@/types';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';
import { SettingsChip } from './settings-chip';

const EMPTY_DRAFT = {
  name: '',
  defaultValue: '',
  defaultCommissionRate: '',
  description: '',
};

/**
 * Settings → Produtos. Account-wide catalog of pre-registered products
 * (name, default value, default commission rate) an agent can pick
 * from when adding a line item to a deal (deal-form.tsx's "Escolher do
 * catálogo" — #7), instead of typing everything from scratch each time.
 *
 * Writes are admin-gated by `product_catalog` RLS (migration 030); the
 * caller-side `canEditSettings` check is defense-in-depth / UX only.
 */
export function ProductCatalogSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [products, setProducts] = useState<ProductCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductCatalogItem | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from('product_catalog')
      .select('*')
      .order('name');
    setProducts((data as ProductCatalogItem[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchProducts();
    }
  }, [accountId, fetchProducts]);

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setDialogOpen(true);
  }

  function openEdit(product: ProductCatalogItem) {
    setEditing(product);
    setDraft({
      name: product.name,
      defaultValue: String(product.default_value ?? ''),
      defaultCommissionRate: product.default_commission_rate
        ? String(product.default_commission_rate)
        : '',
      description: product.description ?? '',
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    const name = draft.name.trim();
    if (!name || !accountId) return;
    setSaving(true);

    const payload = {
      name,
      default_value: parseFloat(draft.defaultValue) || 0,
      default_commission_rate: parseFloat(draft.defaultCommissionRate) || 0,
      description: draft.description.trim() || null,
    };

    const { error } = editing
      ? await supabase.from('product_catalog').update(payload).eq('id', editing.id)
      : await supabase.from('product_catalog').insert({ ...payload, account_id: accountId });

    setSaving(false);
    if (error) {
      toast.error(editing ? 'Falha ao salvar produto' : 'Falha ao criar produto');
      return;
    }
    toast.success(editing ? 'Produto atualizado' : 'Produto criado');
    setDialogOpen(false);
    await fetchProducts();
  }

  async function handleToggleActive(product: ProductCatalogItem) {
    setBusyId(product.id);
    const { error } = await supabase
      .from('product_catalog')
      .update({ is_active: !product.is_active })
      .eq('id', product.id);
    setBusyId(null);
    if (error) {
      toast.error('Falha ao atualizar status');
      return;
    }
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, is_active: !p.is_active } : p)),
    );
  }

  async function handleDelete(product: ProductCatalogItem) {
    if (!window.confirm(`Excluir o produto "${product.name}" do catálogo?`)) return;
    setBusyId(product.id);
    const { error } = await supabase.from('product_catalog').delete().eq('id', product.id);
    setBusyId(null);
    if (error) {
      toast.error('Falha ao excluir produto');
      return;
    }
    toast.success('Produto excluído');
    setProducts((prev) => prev.filter((p) => p.id !== product.id));
  }

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Produtos"
        description="Catálogo de produtos pré-cadastrados — nome, valor e comissão padrão que o agente pode escolher ao adicionar um produto num negócio."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Package className="size-4 text-primary" />
            Catálogo de produtos
            <SettingsChip variant="admin" className="font-medium">
              <Shield />
              Admin
            </SettingsChip>
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Só administradores podem criar, editar ou excluir produtos do catálogo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEditSettings && (
            <div className="flex justify-end">
              <Button
                onClick={openCreate}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="size-4" />
                Novo produto
              </Button>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Nome</TableHead>
                  <TableHead className="text-muted-foreground">Valor padrão</TableHead>
                  <TableHead className="text-muted-foreground">Comissão padrão</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  {canEditSettings && <TableHead className="w-20 text-muted-foreground" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      <Loader2 className="mx-auto size-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : products.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum produto cadastrado ainda.
                    </TableCell>
                  </TableRow>
                ) : (
                  products.map((product) => (
                    <TableRow key={product.id} className="group border-border">
                      <TableCell className="text-sm font-medium text-foreground">
                        {product.name}
                      </TableCell>
                      <TableCell className="text-sm text-foreground">
                        {formatCurrency(product.default_value)}
                      </TableCell>
                      <TableCell className="text-sm text-foreground">
                        {product.default_commission_rate ? `${product.default_commission_rate}%` : '—'}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={product.is_active}
                          onCheckedChange={() => handleToggleActive(product)}
                          disabled={!canEditSettings || busyId === product.id}
                          aria-label={`${product.is_active ? 'Desativar' : 'Ativar'} ${product.name}`}
                        />
                      </TableCell>
                      {canEditSettings && (
                        <TableCell>
                          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => openEdit(product)}
                              aria-label={`Editar ${product.name}`}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(product)}
                              disabled={busyId === product.id}
                              aria-label={`Excluir ${product.name}`}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-400 disabled:opacity-50"
                            >
                              {busyId === product.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="size-3.5" />
                              )}
                            </button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editing ? 'Editar produto' : 'Novo produto'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Esses valores só preenchem os campos por padrão — o agente ainda pode
              ajustá-los ao adicionar o produto num negócio.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Nome</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Nome do produto"
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Valor padrão</Label>
                <Input
                  type="number"
                  value={draft.defaultValue}
                  onChange={(e) => setDraft((prev) => ({ ...prev, defaultValue: e.target.value }))}
                  placeholder="0"
                  className="border-border bg-muted text-foreground"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Comissão padrão (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={draft.defaultCommissionRate}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, defaultCommissionRate: e.target.value }))
                  }
                  placeholder="0"
                  className="border-border bg-muted text-foreground"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Descrição</Label>
              <Textarea
                value={draft.description}
                onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Opcional"
                className="min-h-[80px] border-border bg-muted text-foreground"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || !draft.name.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : editing ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
