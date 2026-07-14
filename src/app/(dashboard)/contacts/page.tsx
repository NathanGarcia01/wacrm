'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag, Profile } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Search,
  Plus,
  Upload,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Filter,
  X,
  Download,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import { BulkAddTagButton, BulkRemoveTagButton } from '@/components/contacts/bulk-tag-actions';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { Checkbox } from '@/components/ui/checkbox';

type DateRangeFilter = 'today' | 'week' | 'month' | 'custom';

/** Start/end ISO bounds for a date-created filter — `to` stays null for
 *  the rolling ranges (today/week/month look back from now with no
 *  upper bound); only 'custom' supplies both ends. */
function computeDateBounds(
  range: DateRangeFilter | null,
  customFrom: string,
  customTo: string
): { from: string | null; to: string | null } {
  if (!range) return { from: null, to: null };
  if (range === 'custom') {
    return {
      from: customFrom ? new Date(`${customFrom}T00:00:00`).toISOString() : null,
      to: customTo ? new Date(`${customTo}T23:59:59.999`).toISOString() : null,
    };
  }
  const from = new Date();
  if (range === 'today') from.setHours(0, 0, 0, 0);
  else if (range === 'week') from.setDate(from.getDate() - 7);
  else from.setMonth(from.getMonth() - 1);
  return { from: from.toISOString(), to: null };
}

const PAGE_SIZE = 25;

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

export default function ContactsPage() {
  const t = useTranslations('contacts');
  const tc = useTranslations('common');
  const supabase = createClient();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  // Tag filter — contacts shown must have ANY of these tags (OR).
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRangeFilter | null>(null);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // Assigned agent lives on the contact's conversation, not the contact
  // row itself — value is a profile.user_id, or the literal "unassigned".
  const [assignedAgent, setAssignedAgent] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection (page-scoped — only the loaded rows are selectable)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  // Guards against out-of-order fetch responses: each fetchContacts run
  // claims a sequence number and only the latest is allowed to commit its
  // results. Without this, rapidly toggling tag filters could let a slower
  // earlier request resolve last and render stale rows.
  const fetchSeq = useRef(0);

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
      // Drop any filter selections whose tag no longer exists (e.g. a tag
      // deleted elsewhere) so it can't linger invisibly in the query.
      setSelectedTagIds((prev) => {
        const pruned = prev.filter((id) => map[id]);
        return pruned.length === prev.length ? prev : pruned;
      });
    }
  }, [supabase]);

  const hasAdvancedFilters =
    selectedTagIds.length > 0 || dateRange !== null || assignedAgent !== null;

  const fetchContacts = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    // The visible rows are about to change — drop any selection that
    // referred to the old page/search results so the bulk bar can't
    // act on rows the user can no longer see.
    setSelected(new Set());

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = search.trim();

    let contactRows: Contact[];
    let count: number;

    if (hasAdvancedFilters) {
      // Any of tags/date/agent active — resolve server-side (join +
      // distinct + windowed total count + pagination) so a filter
      // covering many contacts can't silently truncate the result or
      // overflow an IN clause. See migration 026_filter_contacts_advanced.
      const { from: createdFrom, to: createdTo } = computeDateBounds(
        dateRange,
        customFrom,
        customTo
      );
      const { data, error } = await supabase.rpc('filter_contacts', {
        p_tag_ids: selectedTagIds.length > 0 ? selectedTagIds : null,
        p_search: term || null,
        p_created_from: createdFrom,
        p_created_to: createdTo,
        p_agent_id: assignedAgent && assignedAgent !== 'unassigned' ? assignedAgent : null,
        p_unassigned_only: assignedAgent === 'unassigned',
        p_limit: PAGE_SIZE,
        p_offset: from,
      });
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error(t('loadFailed'));
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as { contact: Contact; total_count: number }[];
      contactRows = rows.map((r) => r.contact);
      count = rows.length > 0 ? Number(rows[0].total_count) : 0;
    } else {
      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (term) {
        const like = `%${term}%`;
        query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`);
      }

      const { data, count: exactCount, error } = await query;
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error(t('loadFailed'));
        setLoading(false);
        return;
      }
      contactRows = data ?? [];
      count = exactCount ?? 0;
    }

    setTotalCount(count);

    if (contactRows.length === 0) {
      setContacts([]);
      setLoading(false);
      return;
    }

    // Fetch tags for these contacts
    const contactIds = contactRows.map((c) => c.id);
    const { data: contactTags } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('contact_id', contactIds);
    if (seq !== fetchSeq.current) return; // superseded by a newer fetch

    const tagsByContact: Record<string, string[]> = {};
    contactTags?.forEach((ct) => {
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(ct.tag_id);
    });

    const enriched: ContactWithTags[] = contactRows.map((c) => ({
      ...c,
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));

    setContacts(enriched);
    setLoading(false);
  }, [
    supabase,
    page,
    search,
    selectedTagIds,
    tagsMap,
    hasAdvancedFilters,
    dateRange,
    customFrom,
    customTo,
    assignedAgent,
    t,
  ]);

  const fetchProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('full_name');
    setProfiles((data ?? []) as Profile[]);
  }, [supabase]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProfiles();
  }, [fetchTags, fetchProfiles]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContacts();
  }, [fetchContacts]);

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string) {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error(t('deleteContactFailed'));
    } else {
      toast.success(t('contactDeleted'));
      fetchContacts();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  const allOnPageSelected =
    contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const someOnPageSelected = contacts.some((c) => selected.has(c.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        contacts.forEach((c) => next.delete(c.id));
      } else {
        contacts.forEach((c) => next.add(c.id));
      }
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);

    const { error } = await supabase.from('contacts').delete().in('id', ids);

    if (error) {
      toast.error(t('deleteContactsFailed'));
    } else {
      toast.success(t('contactsDeletedCount', { count: ids.length }));
      setSelected(new Set());
      fetchContacts();
    }

    setDeleting(false);
    setBulkDeleteOpen(false);
  }

  function csvEscape(value: string): string {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  }

  function handleExportSelected() {
    const rows = contacts.filter((c) => selected.has(c.id));
    if (rows.length === 0) return;

    const header = ['Nome', 'Telefone', 'Email', 'Tags', 'Data de criação'];
    const lines = rows.map((c) =>
      [
        c.name ?? '',
        c.phone,
        c.email ?? '',
        (c.tags ?? []).map((tag) => tag.name).join('; '),
        new Date(c.created_at).toLocaleDateString('pt-BR'),
      ]
        .map((v) => csvEscape(String(v)))
        .join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contatos-selecionados-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  // Filter helpers. Every change resets to page 0 — the result set
  // shrinks/grows so page N may no longer be valid (mirrors the search box).
  const allTags = Object.values(tagsMap).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const activeFilterCount =
    (search.trim().length > 0 ? 1 : 0) +
    (selectedTagIds.length > 0 ? 1 : 0) +
    (dateRange !== null ? 1 : 0) +
    (assignedAgent !== null ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  function toggleTagFilter(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
    setPage(0);
  }

  function clearTagFilters() {
    setSelectedTagIds([]);
    setPage(0);
  }

  function updateDateRange(range: DateRangeFilter | null) {
    setDateRange(range);
    if (range !== 'custom') {
      setCustomFrom('');
      setCustomTo('');
    }
    setPage(0);
  }

  function updateAssignedAgent(agent: string | null) {
    setAssignedAgent(agent);
    setPage(0);
  }

  function clearAllFilters() {
    setSearch('');
    setSelectedTagIds([]);
    setDateRange(null);
    setCustomFrom('');
    setCustomTo('');
    setAssignedAgent(null);
    setPage(0);
  }

  const assignedAgentLabel =
    assignedAgent === 'unassigned'
      ? 'Sem responsável'
      : profiles.find((p) => p.user_id === assignedAgent)?.full_name;

  const dateRangeLabel =
    dateRange === 'today'
      ? 'Hoje'
      : dateRange === 'week'
        ? 'Últimos 7 dias'
        : dateRange === 'month'
          ? 'Últimos 30 dias'
          : dateRange === 'custom'
            ? 'Período personalizado'
            : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('subtitle')} {totalCount > 0 && t('totalContacts', { count: totalCount })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEditSettings && (
            <Button
              variant="outline"
              onClick={() => setCustomFieldsOpen(true)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="size-4" />
              {t('customFields.title')}
            </Button>
          )}
          <GatedButton
            variant="outline"
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={() => setImportOpen(true)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Upload className="size-4" />
            {t('import')}
          </GatedButton>
          <GatedButton
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={openAddForm}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            {t('addContact')}
          </GatedButton>
        </div>
      </div>

      {/* Search + tag filter */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                // Reset pagination when the query changes — the result
                // set shrinks/grows, page N may no longer be valid.
                setPage(0);
              }}
              placeholder={t('searchPlaceholder')}
              className="pl-8 bg-card border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground hover:bg-muted shrink-0"
                />
              }
            >
              <Filter className="size-4" />
              Filtros
              {activeFilterCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[10px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-sm font-medium text-popover-foreground">Filtros</span>
                {hasActiveFilters && (
                  <button
                    onClick={clearAllFilters}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>

              <div className="max-h-[26rem] overflow-y-auto p-3 space-y-4">
                {/* Tags */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t('filterByTags')}
                    </label>
                    {selectedTagIds.length > 0 && (
                      <button
                        onClick={clearTagFilters}
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        {t('clearAll')}
                      </button>
                    )}
                  </div>
                  {allTags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('noTagsYet')}</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                      {allTags.map((tag) => (
                        <label
                          key={tag.id}
                          className="flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={selectedTagIds.includes(tag.id)}
                            onCheckedChange={() => toggleTagFilter(tag.id)}
                            aria-label={t('filterByTagAria', { name: tag.name })}
                          />
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="text-sm text-popover-foreground truncate">
                            {tag.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Date created */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Data de criação
                  </label>
                  <select
                    value={dateRange ?? ''}
                    onChange={(e) =>
                      updateDateRange((e.target.value || null) as DateRangeFilter | null)
                    }
                    className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Qualquer data</option>
                    <option value="today">Hoje</option>
                    <option value="week">Últimos 7 dias</option>
                    <option value="month">Últimos 30 dias</option>
                    <option value="custom">Personalizado</option>
                  </select>
                  {dateRange === 'custom' && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <input
                        type="date"
                        value={customFrom}
                        onChange={(e) => {
                          setCustomFrom(e.target.value);
                          setPage(0);
                        }}
                        className="h-8 rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
                      />
                      <input
                        type="date"
                        value={customTo}
                        onChange={(e) => {
                          setCustomTo(e.target.value);
                          setPage(0);
                        }}
                        className="h-8 rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
                      />
                    </div>
                  )}
                </div>

                {/* Assigned agent */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Responsável
                  </label>
                  <select
                    value={assignedAgent ?? ''}
                    onChange={(e) => updateAssignedAgent(e.target.value || null)}
                    className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Qualquer responsável</option>
                    <option value="unassigned">Sem responsável</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.user_id}>
                        {p.full_name || p.email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Active-filter chips */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedTagIds.map((id) => {
              const tag = tagsMap[id];
              if (!tag) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: tag.color + '20',
                    color: tag.color,
                  }}
                >
                  {tag.name}
                  <button
                    onClick={() => toggleTagFilter(id)}
                    aria-label={t('removeTagFilterAria', { name: tag.name })}
                    className="hover:opacity-70"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
            {dateRangeLabel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                {dateRangeLabel}
                <button onClick={() => updateDateRange(null)} aria-label="Remover filtro de data" className="hover:opacity-70">
                  <X className="size-3" />
                </button>
              </span>
            )}
            {assignedAgentLabel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                {assignedAgentLabel}
                <button onClick={() => updateAssignedAgent(null)} aria-label="Remover filtro de responsável" className="hover:opacity-70">
                  <X className="size-3" />
                </button>
              </span>
            )}
            <button
              onClick={clearAllFilters}
              className="text-xs text-muted-foreground hover:text-foreground px-1"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-4 py-2">
          <p className="text-sm text-foreground">
            {t('selectedCount', { count: selected.size })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              className="text-muted-foreground hover:text-foreground"
            >
              {t('clear')}
            </Button>
            {canEdit && (
              <>
                <BulkAddTagButton
                  contactIds={[...selected]}
                  onApplied={() => {
                    setSelected(new Set());
                    fetchContacts();
                  }}
                />
                <BulkRemoveTagButton
                  contactIds={[...selected]}
                  tagsMap={tagsMap}
                  onApplied={() => {
                    setSelected(new Set());
                    fetchContacts();
                  }}
                />
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportSelected}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <Download className="size-4" />
              Exportar selecionados
            </Button>
            <GatedButton
              variant="destructive"
              size="sm"
              canAct={canEdit}
              gateReason="delete contacts"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              {t('deleteSelected')}
            </GatedButton>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allOnPageSelected}
                  indeterminate={!allOnPageSelected && someOnPageSelected}
                  onCheckedChange={toggleSelectAll}
                  disabled={contacts.length === 0}
                  aria-label={t('selectAllAria')}
                />
              </TableHead>
              <TableHead className="text-muted-foreground">{t('columnName')}</TableHead>
              <TableHead className="text-muted-foreground">{t('columnPhone')}</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">{t('columnEmail')}</TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">{t('columnCompany')}</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">{t('columnTags')}</TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">{t('columnCreated')}</TableHead>
              <TableHead className="text-muted-foreground w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">{t('loadingContacts')}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {hasActiveFilters
                        ? t('noContactsMatchFilters')
                        : t('noContactsYet')}
                    </p>
                    {!hasActiveFilters && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="mt-2 border-border text-muted-foreground hover:bg-muted"
                      >
                        <Plus className="size-3.5" />
                        {t('addFirstContact')}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="border-border hover:bg-muted/50 cursor-pointer"
                  onClick={() => openDetail(contact.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(contact.id)}
                      onCheckedChange={() => toggleSelect(contact.id)}
                      aria-label={t('selectContactAria', { name: contact.name || contact.phone })}
                    />
                  </TableCell>
                  <TableCell className="text-foreground font-medium">
                    {contact.name || <span className="text-muted-foreground italic">{t('unnamed')}</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {contact.phone}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell text-sm">
                    {contact.email || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell text-sm">
                    {contact.company || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {contact.tags && contact.tags.length > 0 ? (
                        contact.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                      {contact.tags && contact.tags.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{contact.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground text-xs hidden lg:table-cell">
                    {new Date(contact.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-popover border-border"
                      >
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(contact);
                          }}
                          className="text-popover-foreground focus:bg-muted focus:text-foreground"
                        >
                          <Pencil className="size-4" />
                          {tc('edit')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(contact);
                          }}
                        >
                          <Trash2 className="size-4" />
                          {tc('delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs text-muted-foreground">
            {t('showingRange', {
              from: page * PAGE_SIZE + 1,
              to: Math.min((page + 1) * PAGE_SIZE, totalCount),
              total: totalCount,
            })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="font-mono text-xs text-muted-foreground px-2">
              {t('pageOf', { page: page + 1, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
        }}
        onViewExisting={(id) => {
          setFormOpen(false);
          openDetail(id);
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        onUpdated={fetchContacts}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchContacts}
      />

      {/* Custom Fields Manager (admin+) */}
      {canEditSettings && (
        <CustomFieldsManager
          open={customFieldsOpen}
          onOpenChange={setCustomFieldsOpen}
        />
      )}

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('deleteContactTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteContactConfirmPrefix')}{' '}
              <span className="text-popover-foreground font-medium">
                {deleteTarget?.name || deleteTarget?.phone}
              </span>
              {t('deleteConfirmSuffix')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {tc('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {tc('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('deleteContactsCountTitle', { count: selected.size })}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteContactConfirmPrefix')}{' '}
              <span className="text-popover-foreground font-medium">
                {t('contactsCount', { count: selected.size })}
              </span>
              {t('deleteConfirmSuffix')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {tc('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {tc('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
