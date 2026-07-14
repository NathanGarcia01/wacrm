'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { Loader2, Plus, Search, Tag as TagIcon, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Tag } from '@/types';

// Mirrors src/components/inbox/tag-picker-popover.tsx so a tag created
// from either surface looks consistent.
const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

interface ImportTagMultiSelectProps {
  selected: Tag[];
  onChange: (tags: Tag[]) => void;
}

/**
 * Multi-select tag picker for the contacts import flow — search existing
 * account tags, toggle several on, or create a new one inline. Unlike
 * TagPickerPopover (single contact, one tag at a time), this accumulates
 * a set of tags to apply to every contact in the CSV once import runs.
 */
export function ImportTagMultiSelect({ selected, onChange }: ImportTagMultiSelectProps) {
  const { user, accountId } = useAuth();
  const [open, setOpen] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[3]);
  const [savingNew, setSavingNew] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const supabase = createClient();
    (async () => {
      const { data } = await supabase.from('tags').select('*').order('name');
      if (cancelled) return;
      setAllTags((data ?? []) as Tag[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery('');
      setCreating(false);
      setNewName('');
    }
  }, [open]);

  const selectedIds = useMemo(() => new Set(selected.map((t) => t.id)), [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter((t) => t.name.toLowerCase().includes(q));
  }, [allTags, query]);

  function toggle(tag: Tag) {
    if (selectedIds.has(tag.id)) {
      onChange(selected.filter((t) => t.id !== tag.id));
    } else {
      onChange([...selected, tag]);
    }
  }

  function removeSelected(tagId: string) {
    onChange(selected.filter((t) => t.id !== tagId));
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    if (!user || !accountId) {
      toast.error('Não autenticado');
      return;
    }
    setSavingNew(true);
    const supabase = createClient();
    const { data: tag, error } = await supabase
      .from('tags')
      .insert({ user_id: user.id, account_id: accountId, name, color: newColor })
      .select()
      .single();
    setSavingNew(false);
    if (error || !tag) {
      toast.error('Falha ao criar tag');
      return;
    }
    setAllTags((prev) => [...prev, tag as Tag].sort((a, b) => a.name.localeCompare(b.name)));
    onChange([...selected, tag as Tag]);
    setNewName('');
    setNewColor(PRESET_COLORS[3]);
    setCreating(false);
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full justify-start border-border bg-muted text-sm font-normal text-muted-foreground hover:bg-muted"
            />
          }
        >
          <TagIcon className="size-3.5" />
          {selected.length > 0
            ? `${selected.length} tag${selected.length !== 1 ? 's' : ''} selecionada${selected.length !== 1 ? 's' : ''}`
            : 'Buscar ou criar tags…'}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar tags…"
              className="h-8 bg-muted pl-7 text-xs"
              autoFocus
            />
          </div>

          <div className="mt-2 max-h-48 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                {query ? 'Nenhuma tag encontrada.' : 'Nenhuma tag ainda.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {filtered.map((tag) => {
                  const isSelected = selectedIds.has(tag.id);
                  return (
                    <li key={tag.id}>
                      <button
                        type="button"
                        onClick={() => toggle(tag)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted',
                          isSelected && 'bg-primary/10'
                        )}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="flex-1 truncate text-foreground">{tag.name}</span>
                        {isSelected && <span className="text-primary text-[10px]">✓</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-2 border-t border-border pt-2">
            {creating ? (
              <div className="flex flex-col gap-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nome da nova tag"
                  maxLength={40}
                  className="h-8 bg-muted text-xs"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                  }}
                />
                <div className="flex items-center gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColor(c)}
                      aria-label={`Usar cor ${c}`}
                      aria-pressed={newColor === c}
                      className={cn(
                        'h-4 w-4 rounded-full transition-transform hover:scale-110',
                        newColor === c && 'ring-2 ring-primary ring-offset-1 ring-offset-popover'
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 flex-1 text-xs"
                    onClick={() => setCreating(false)}
                    disabled={savingNew}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    onClick={handleCreate}
                    disabled={savingNew || !newName.trim()}
                  >
                    {savingNew ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Criar'}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="text-primary hover:bg-primary/10 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Criar nova tag
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
            >
              {tag.name}
              <button
                type="button"
                onClick={() => removeSelected(tag.id)}
                aria-label={`Remover tag ${tag.name}`}
                className="hover:opacity-70"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
