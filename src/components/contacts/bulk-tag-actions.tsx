'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Loader2, Plus, Minus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import type { Tag } from '@/types';

interface BulkAddTagButtonProps {
  contactIds: string[];
  onApplied: () => void;
}

/** Bulk-action-bar button: pick an existing tag, apply it to every selected contact. */
export function BulkAddTagButton({ contactIds, onApplied }: BulkAddTagButtonProps) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const supabase = createClient();
    (async () => {
      const { data } = await supabase.from('tags').select('*').order('name');
      if (cancelled) return;
      setTags((data ?? []) as Tag[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function applyTag(tag: Tag) {
    setApplyingId(tag.id);
    const supabase = createClient();
    const rows = contactIds.map((contactId) => ({ contact_id: contactId, tag_id: tag.id }));
    const { error } = await supabase
      .from('contact_tags')
      .upsert(rows, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true });
    setApplyingId(null);
    if (error) {
      toast.error('Falha ao adicionar tag');
      return;
    }
    toast.success(`Tag "${tag.name}" aplicada a ${contactIds.length} contato${contactIds.length !== 1 ? 's' : ''}`);
    setOpen(false);
    onApplied();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-muted" />
        }
      >
        <Plus className="size-4" />
        Adicionar tag
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : tags.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Nenhuma tag ainda.</p>
        ) : (
          <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {tags.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  onClick={() => applyTag(tag)}
                  disabled={applyingId === tag.id}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                  <span className="flex-1 truncate text-foreground">{tag.name}</span>
                  {applyingId === tag.id && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface BulkRemoveTagButtonProps {
  contactIds: string[];
  tagsMap: Record<string, Tag>;
  onApplied: () => void;
}

/** Bulk-action-bar button: pick a tag that at least one selected contact has, remove it from all of them. */
export function BulkRemoveTagButton({ contactIds, tagsMap, onApplied }: BulkRemoveTagButtonProps) {
  const [open, setOpen] = useState(false);
  const [presentTags, setPresentTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from('contact_tags')
        .select('tag_id')
        .in('contact_id', contactIds);
      if (cancelled) return;
      const ids = new Set((data ?? []).map((r) => r.tag_id));
      setPresentTags(
        [...ids].map((id) => tagsMap[id]).filter((t): t is Tag => Boolean(t)).sort((a, b) => a.name.localeCompare(b.name))
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contactIds.join(',')]);

  async function removeTag(tag: Tag) {
    setRemovingId(tag.id);
    const supabase = createClient();
    const { error } = await supabase
      .from('contact_tags')
      .delete()
      .eq('tag_id', tag.id)
      .in('contact_id', contactIds);
    setRemovingId(null);
    if (error) {
      toast.error('Falha ao remover tag');
      return;
    }
    toast.success(`Tag "${tag.name}" removida de ${contactIds.length} contato${contactIds.length !== 1 ? 's' : ''}`);
    setOpen(false);
    onApplied();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-muted" />
        }
      >
        <Minus className="size-4" />
        Remover tag
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : presentTags.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            Nenhuma tag nos contatos selecionados.
          </p>
        ) : (
          <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {presentTags.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  disabled={removingId === tag.id}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                  <span className="flex-1 truncate text-foreground">{tag.name}</span>
                  {removingId === tag.id && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
