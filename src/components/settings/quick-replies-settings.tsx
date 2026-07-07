'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageSquareText, Pencil, Plus, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { QuickReply } from '@/types';
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
import { SettingsPanelHead } from './settings-panel-head';

const EMPTY_DRAFT = {
  title: '',
  shortcut: '',
  content: '',
};

function normalizeShortcut(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Settings → Respostas Rápidas. Account-wide catalog of canned replies
 * an agent can insert into the composer by typing "/" (message-composer.tsx).
 *
 * Unlike the product catalog, `quick_replies` RLS (migration 031) grants
 * write access at the 'agent' tier, not admin-only — every agent manages
 * their own shortcuts, so there's no admin chip/gating here.
 */
export function QuickRepliesSettings() {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchReplies = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from('quick_replies')
      .select('*')
      .order('title');
    setReplies((data as QuickReply[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchReplies();
    }
  }, [accountId, fetchReplies]);

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setDialogOpen(true);
  }

  function openEdit(reply: QuickReply) {
    setEditing(reply);
    setDraft({
      title: reply.title,
      shortcut: reply.shortcut ?? '',
      content: reply.content,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    const title = draft.title.trim();
    const content = draft.content.trim();
    if (!title || !content || !accountId) return;
    setSaving(true);

    const payload = {
      title,
      content,
      shortcut: normalizeShortcut(draft.shortcut) || null,
    };

    const { error } = editing
      ? await supabase.from('quick_replies').update(payload).eq('id', editing.id)
      : await supabase.from('quick_replies').insert({ ...payload, account_id: accountId });

    setSaving(false);
    if (error) {
      toast.error(editing ? 'Falha ao salvar resposta' : 'Falha ao criar resposta');
      return;
    }
    toast.success(editing ? 'Resposta atualizada' : 'Resposta criada');
    setDialogOpen(false);
    await fetchReplies();
  }

  async function handleDelete(reply: QuickReply) {
    if (!window.confirm(`Excluir a resposta rápida "${reply.title}"?`)) return;
    setBusyId(reply.id);
    const { error } = await supabase.from('quick_replies').delete().eq('id', reply.id);
    setBusyId(null);
    if (error) {
      toast.error('Falha ao excluir resposta');
      return;
    }
    toast.success('Resposta excluída');
    setReplies((prev) => prev.filter((r) => r.id !== reply.id));
  }

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Respostas Rápidas"
        description="Mensagens prontas que qualquer agente pode inserir na caixa de mensagem digitando '/'."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <MessageSquareText className="size-4 text-primary" />
            Respostas cadastradas
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Digite &quot;/&quot; na caixa de mensagem do inbox para escolher uma resposta rápida.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-end">
            <Button
              onClick={openCreate}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="size-4" />
              Nova resposta
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Título</TableHead>
                  <TableHead className="text-muted-foreground">Atalho</TableHead>
                  <TableHead className="text-muted-foreground">Conteúdo</TableHead>
                  <TableHead className="w-20 text-muted-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      <Loader2 className="mx-auto size-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : replies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhuma resposta rápida cadastrada ainda.
                    </TableCell>
                  </TableRow>
                ) : (
                  replies.map((reply) => (
                    <TableRow key={reply.id} className="group border-border">
                      <TableCell className="text-sm font-medium text-foreground">
                        {reply.title}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {reply.shortcut || '—'}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-foreground">
                        {reply.content}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => openEdit(reply)}
                            aria-label={`Editar ${reply.title}`}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(reply)}
                            disabled={busyId === reply.id}
                            aria-label={`Excluir ${reply.title}`}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-400 disabled:opacity-50"
                          >
                            {busyId === reply.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                          </button>
                        </div>
                      </TableCell>
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
              {editing ? 'Editar resposta' : 'Nova resposta'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              O atalho é o que o agente digita depois de &quot;/&quot; para encontrar essa resposta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Título</Label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Ex: Saudação inicial"
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Atalho</Label>
              <Input
                value={draft.shortcut}
                onChange={(e) => setDraft((prev) => ({ ...prev, shortcut: e.target.value }))}
                placeholder="/saudacao"
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Conteúdo</Label>
              <Textarea
                value={draft.content}
                onChange={(e) => setDraft((prev) => ({ ...prev, content: e.target.value }))}
                placeholder="Texto que será inserido na conversa"
                className="min-h-[100px] border-border bg-muted text-foreground"
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
              disabled={saving || !draft.title.trim() || !draft.content.trim()}
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
