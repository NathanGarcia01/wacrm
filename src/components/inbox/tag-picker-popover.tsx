"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Loader2, Plus, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Tag } from "@/types";

// Mirrors the palette in src/components/settings/tag-manager.tsx so a
// tag created from either surface looks consistent.
const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

interface TagPickerPopoverProps {
  contactId: string;
  /** Tag ids already on this contact — excluded from the pickable list. */
  existingTagIds: string[];
  /** Called after a tag is attached (existing or newly created) so the caller can refetch. */
  onChanged: () => void;
}

export function TagPickerPopover({
  contactId,
  existingTagIds,
  onChanged,
}: TagPickerPopoverProps) {
  const { user, accountId } = useAuth();
  const [open, setOpen] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[3]);
  const [savingNew, setSavingNew] = useState(false);

  // Load the account's tags each time the popover opens — cheap query,
  // and guarantees a tag created elsewhere (Settings) shows up.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const supabase = createClient();
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
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
      setQuery("");
      setCreating(false);
      setNewName("");
    }
  }, [open]);

  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allTags
      .filter((t) => !existingTagIds.includes(t.id))
      .filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [allTags, existingTagIds, query]);

  async function handleAdd(tagId: string) {
    setAddingId(tagId);
    const supabase = createClient();
    const { error } = await supabase
      .from("contact_tags")
      .insert({ contact_id: contactId, tag_id: tagId });
    setAddingId(null);
    if (error) {
      toast.error("Falha ao adicionar tag");
      return;
    }
    onChanged();
  }

  async function handleCreateAndAdd() {
    const name = newName.trim();
    if (!name) return;
    if (!user || !accountId) {
      toast.error("Não autenticado");
      return;
    }
    setSavingNew(true);
    const supabase = createClient();
    const { data: tag, error } = await supabase
      .from("tags")
      .insert({ user_id: user.id, account_id: accountId, name, color: newColor })
      .select()
      .single();
    if (error || !tag) {
      toast.error("Falha ao criar tag");
      setSavingNew(false);
      return;
    }
    const { error: linkError } = await supabase
      .from("contact_tags")
      .insert({ contact_id: contactId, tag_id: tag.id });
    setSavingNew(false);
    if (linkError) {
      toast.error("Tag criada, mas falhou ao adicionar ao contato");
      return;
    }
    setNewName("");
    setNewColor(PRESET_COLORS[3]);
    setCreating(false);
    setAllTags((prev) =>
      [...prev, tag as Tag].sort((a, b) => a.name.localeCompare(b.name)),
    );
    onChanged();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Adicionar tag"
        className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <Plus className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
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

        <div className="mt-2 max-h-40 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : available.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {query ? "Nenhuma tag encontrada." : "Todas as tags já estão neste contato."}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {available.map((tag) => (
                <li key={tag.id}>
                  <button
                    type="button"
                    onClick={() => handleAdd(tag.id)}
                    disabled={addingId === tag.id}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="flex-1 truncate text-foreground">{tag.name}</span>
                    {addingId === tag.id && (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </button>
                </li>
              ))}
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
                  if (e.key === "Enter") handleCreateAndAdd();
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
                      "h-4 w-4 rounded-full transition-transform hover:scale-110",
                      newColor === c &&
                        "ring-2 ring-primary ring-offset-1 ring-offset-popover",
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
                  onClick={handleCreateAndAdd}
                  disabled={savingNew || !newName.trim()}
                >
                  {savingNew ? <Loader2 className="h-3 w-3 animate-spin" /> : "Criar"}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-primary hover:bg-primary/10"
            >
              <Plus className="h-3.5 w-3.5" />
              Criar nova tag
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
