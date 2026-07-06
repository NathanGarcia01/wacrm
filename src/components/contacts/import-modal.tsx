'use client';

import { useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  dedupeByPhone,
  isUniqueViolation,
  normalizeKey,
} from '@/lib/contacts/dedupe';
import {
  parseCsvGeneric,
  suggestColumnMappings,
  type ColumnMapping,
  type SystemFieldMapping,
} from '@/lib/contacts/parse-csv-generic';
import { buildMappedContactRows } from '@/lib/contacts/build-mapped-contact-rows';
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';
import {
  assignImportedCustomFieldValues,
  resolveImportCustomFieldIds,
  type ContactCustomFieldValue,
} from '@/lib/contacts/resolve-import-custom-fields';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Tag,
  Columns3,
} from 'lucide-react';

const DEFAULT_TAG_COLOR = '#3b82f6';
const PREVIEW_LIMIT = 5;

const MAPPING_OPTIONS: { value: string; label: string }[] = [
  { value: 'system:name', label: 'Nome' },
  { value: 'system:phone', label: 'Telefone' },
  { value: 'system:email', label: 'Email' },
  { value: 'system:company', label: 'Empresa' },
  { value: 'system:tags', label: 'Tags' },
  { value: 'custom', label: 'Campo personalizado' },
  { value: 'ignore', label: 'Ignorar' },
];

function mappingToValue(m: ColumnMapping): string {
  if (m.kind === 'system') return `system:${m.field}`;
  return m.kind;
}

function valueToMapping(value: string, header: string): ColumnMapping {
  if (value.startsWith('system:')) {
    return { kind: 'system', field: value.slice('system:'.length) as SystemFieldMapping };
  }
  if (value === 'custom') return { kind: 'custom', fieldName: header };
  return { kind: 'ignore' };
}

function truncateFilename(name: string, max = 48): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = max - ext.length - 1;
  return `${base.slice(0, Math.max(keep, 12))}…${ext}`;
}

function PreviewCell({
  value,
  mono,
  maxWidth = 'max-w-[9rem]',
}: {
  value: string;
  mono?: boolean;
  maxWidth?: string;
}) {
  return (
    <span
      className={cn('block truncate', maxWidth, mono && 'font-mono text-[11px]')}
      title={value}
    >
      {value}
    </span>
  );
}

function ImportPreviewTags({
  tagNames,
  tagColorByKey,
}: {
  tagNames: string[];
  tagColorByKey: Map<string, string>;
}) {
  if (tagNames.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex min-w-[4.5rem] flex-wrap gap-1">
      {tagNames.map((name) => {
        const color =
          tagColorByKey.get(name.trim().toLowerCase()) ?? DEFAULT_TAG_COLOR;
        const isKnown = tagColorByKey.has(name.trim().toLowerCase());
        return (
          <span
            key={name}
            className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-none font-medium"
            style={{
              backgroundColor: `${color}18`,
              color,
              border: `1px solid ${color}${isKnown ? '55' : '30'}`,
            }}
            title={isKnown ? name : `${name} (será criada na importação)`}
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="truncate">{name}</span>
          </span>
        );
      })}
    </div>
  );
}

function ImportPreviewCustomValues({ values }: { values: Map<string, string> }) {
  if (values.size === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const summary = Array.from(values.entries())
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ');
  return <PreviewCell value={summary} maxWidth="max-w-[12rem]" />;
}

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportModal({
  open,
  onOpenChange,
  onImported,
}: ImportModalProps) {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [tagColorByKey, setTagColorByKey] = useState<Map<string, string>>(
    new Map()
  );
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    failed: number;
    tagsAssigned: number;
    customValuesAssigned: number;
  } | null>(null);

  function reset() {
    setFile(null);
    setHeaders([]);
    setRawRows([]);
    setMappings([]);
    setTagColorByKey(new Map());
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const { headers: parsedHeaders, rows } = parseCsvGeneric(text);

    if (parsedHeaders.length === 0 || rows.length === 0) {
      toast.error('Nenhuma linha válida encontrada no arquivo CSV.');
      setHeaders([]);
      setRawRows([]);
      setMappings([]);
      setTagColorByKey(new Map());
      return;
    }

    setHeaders(parsedHeaders);
    setRawRows(rows);
    setMappings(suggestColumnMappings(parsedHeaders));

    if (accountId) {
      const { data: tags } = await supabase
        .from('tags')
        .select('name, color')
        .eq('account_id', accountId);

      const colors = new Map<string, string>();
      for (const tag of tags ?? []) {
        const key = tag.name.trim().toLowerCase();
        if (!colors.has(key)) colors.set(key, tag.color);
      }
      setTagColorByKey(colors);
    } else {
      setTagColorByKey(new Map());
    }
  }

  function handleMappingChange(index: number, value: string) {
    setMappings((prev) => {
      const next = [...prev];
      const chosen = valueToMapping(value, headers[index]);
      // A system field (phone/name/email/company/tags) can only be
      // mapped once — reassigning it here demotes whichever other
      // column previously held it back to a custom field, so that
      // column's data isn't silently lost.
      if (chosen.kind === 'system') {
        for (let i = 0; i < next.length; i++) {
          if (i === index) continue;
          const other = next[i];
          if (other.kind === 'system' && other.field === chosen.field) {
            next[i] = { kind: 'custom', fieldName: headers[i] };
          }
        }
      }
      next[index] = chosen;
      return next;
    });
  }

  const mappedRows = useMemo(
    () => buildMappedContactRows(rawRows, mappings),
    [rawRows, mappings]
  );
  const hasPhoneMapped = mappings.some(
    (m) => m.kind === 'system' && m.field === 'phone'
  );

  async function handleImport() {
    if (mappedRows.length === 0) return;
    setImporting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Não autenticado');
      if (!accountId)
        throw new Error('Seu perfil não está vinculado a uma conta.');

      let imported = 0;
      let skipped = 0;
      let failed = 0;

      // 1) De-dupe within the file by normalized phone (keep first).
      const { unique, duplicates: inFileDupes } = dedupeByPhone(mappedRows);
      skipped += inFileDupes;

      // 2) Skip numbers already in this account. One read of the
      //    generated `phone_normalized` column (migration 022) → Set.
      const { data: existingRows } = await supabase
        .from('contacts')
        .select('phone_normalized')
        .eq('account_id', accountId);
      const existing = new Set(
        (existingRows ?? [])
          .map(
            (r) => (r as { phone_normalized: string | null }).phone_normalized
          )
          .filter((p): p is string => !!p)
      );

      const toInsert = unique.filter((row) => {
        if (existing.has(normalizeKey(row.phone))) {
          skipped++;
          return false;
        }
        return true;
      });

      // 3) Resolve tag names → ids (admin+ may auto-create missing tags).
      const allTagNames = toInsert.flatMap((row) => row.tagNames);
      let tagIdByKey = new Map<string, string>();
      let skippedTagNames: string[] = [];
      if (allTagNames.length > 0) {
        ({ tagIdByKey, skippedNames: skippedTagNames } = await resolveImportTagIds(
          supabase,
          {
            accountId,
            userId: user.id,
            tagNames: allTagNames,
            canCreateTags: canEditSettings,
          }
        ));
      }

      // 3b) Resolve custom-field columns → custom_fields ids (same
      //     admin-gated create-if-missing pattern as tags).
      const allCustomFieldNames = Array.from(
        new Set(
          mappings
            .filter((m): m is Extract<ColumnMapping, { kind: 'custom' }> => m.kind === 'custom')
            .map((m) => m.fieldName)
        )
      );
      let fieldIdByKey = new Map<string, string>();
      let skippedFieldNames: string[] = [];
      if (allCustomFieldNames.length > 0) {
        ({ fieldIdByKey, skippedNames: skippedFieldNames } =
          await resolveImportCustomFieldIds(supabase, {
            accountId,
            userId: user.id,
            fieldNames: allCustomFieldNames,
            canCreateFields: canEditSettings,
          }));
      }

      const tagAssignments: ContactTagAssignment[] = [];
      const customValueAssignments: ContactCustomFieldValue[] = [];

      // 4) Batch insert the genuinely-new rows in chunks of 50. The DB
      //    unique index is the backstop: a 23505 (race, or a format
      //    that normalizes equal) counts as skipped, not failed.
      const chunkSize = 50;

      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const rows = chunk.map((row) => ({
          user_id: user.id,
          account_id: accountId,
          phone: row.phone,
          name: row.name || null,
          email: row.email || null,
          company: row.company || null,
        }));

        const { data, error } = await supabase
          .from('contacts')
          .insert(rows)
          .select('id');

        if (error) {
          // Retry individually so one bad/duplicate row doesn't sink
          // the whole chunk.
          for (let j = 0; j < rows.length; j++) {
            const row = rows[j];
            const source = chunk[j];
            const { data: singleData, error: singleErr } = await supabase
              .from('contacts')
              .insert(row)
              .select('id')
              .single();

            if (!singleErr && singleData) {
              imported++;
              if (source.tagNames.length > 0) {
                tagAssignments.push({
                  contactId: singleData.id,
                  tagNames: source.tagNames,
                });
              }
              if (source.customValues.size > 0) {
                customValueAssignments.push({
                  contactId: singleData.id,
                  values: source.customValues,
                });
              }
            } else if (isUniqueViolation(singleErr)) {
              skipped++;
            } else {
              failed++;
            }
          }
        } else {
          const inserted = data ?? [];
          imported += inserted.length;
          // inserted[j] ↔ chunk[j] only holds because a single INSERT
          // preserves RETURNING order. If this path is ever split into
          // parallel inserts, zip by phone or returned id instead.
          for (let j = 0; j < inserted.length; j++) {
            const source = chunk[j];
            if (!source) continue;
            if (source.tagNames.length > 0) {
              tagAssignments.push({
                contactId: inserted[j].id,
                tagNames: source.tagNames,
              });
            }
            if (source.customValues.size > 0) {
              customValueAssignments.push({
                contactId: inserted[j].id,
                values: source.customValues,
              });
            }
          }
        }
      }

      // 5) Wire tags + custom field values onto the contacts we just
      //    created. Failure here must not mask a successful import.
      let tagsAssigned = 0;
      try {
        tagsAssigned = await assignImportedContactTags(
          supabase,
          tagAssignments,
          tagIdByKey
        );
      } catch {
        toast.warning('Contatos importados, mas algumas tags falharam.');
      }

      let customValuesAssigned = 0;
      try {
        customValuesAssigned = await assignImportedCustomFieldValues(
          supabase,
          customValueAssignments,
          fieldIdByKey
        );
      } catch {
        toast.warning('Contatos importados, mas alguns campos personalizados falharam.');
      }

      setResult({ imported, skipped, failed, tagsAssigned, customValuesAssigned });
      if (imported > 0) {
        toast.success(
          `${imported} contato${imported !== 1 ? 's' : ''} importado${imported !== 1 ? 's' : ''}`
        );
        onImported();
      }
      if (tagsAssigned > 0) {
        toast.success(
          `${tagsAssigned} tag${tagsAssigned !== 1 ? 's' : ''} aplicada${tagsAssigned !== 1 ? 's' : ''}`
        );
      }
      if (customValuesAssigned > 0) {
        toast.success(
          `${customValuesAssigned} campo${customValuesAssigned !== 1 ? 's' : ''} personalizado${customValuesAssigned !== 1 ? 's' : ''} preenchido${customValuesAssigned !== 1 ? 's' : ''}`
        );
      }
      if (skippedTagNames.length > 0) {
        const sample = skippedTagNames.slice(0, 3).join(', ');
        const more =
          skippedTagNames.length > 3 ? ` (+${skippedTagNames.length - 3})` : '';
        toast.info(
          `Tags desconhecidas ignoradas (crie-as em Configurações antes): ${sample}${more}`
        );
      }
      if (skippedFieldNames.length > 0) {
        const sample = skippedFieldNames.slice(0, 3).join(', ');
        const more =
          skippedFieldNames.length > 3 ? ` (+${skippedFieldNames.length - 3})` : '';
        toast.info(
          `Campos personalizados ignorados (apenas administradores podem criá-los): ${sample}${more}`
        );
      }
      if (skipped > 0) {
        toast.info(`${skipped} duplicado${skipped !== 1 ? 's' : ''} ignorado${skipped !== 1 ? 's' : ''}`);
      }
      if (failed > 0) {
        toast.error(`${failed} contato${failed !== 1 ? 's' : ''} falhou ao importar`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha na importação';
      toast.error(message);
    } finally {
      setImporting(false);
    }
  }

  const preview = mappedRows.slice(0, PREVIEW_LIMIT);
  const previewHasTags = mappings.some(
    (m) => m.kind === 'system' && m.field === 'tags'
  );
  const previewHasCompany = mappings.some(
    (m) => m.kind === 'system' && m.field === 'company'
  );
  const previewHasCustom = mappings.some((m) => m.kind === 'custom');

  const tagStats = useMemo(() => {
    const names = new Set<string>();
    let rowsWithTags = 0;
    for (const row of mappedRows) {
      if (row.tagNames.length === 0) continue;
      rowsWithTags++;
      for (const name of row.tagNames) names.add(name.trim().toLowerCase());
    }
    return { unique: names.size, rowsWithTags };
  }, [mappedRows]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,760px)] flex-col gap-0 overflow-hidden border-border/80 bg-popover p-0 text-popover-foreground sm:max-w-2xl">
        <div className="shrink-0 space-y-4 border-b border-border/80 px-6 pt-6 pb-5">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg text-popover-foreground">
              Importar contatos
            </DialogTitle>
            <DialogDescription className="leading-relaxed text-muted-foreground">
              Envie um CSV com qualquer conjunto de colunas. Depois do upload,
              você mapeia cada coluna para um campo do sistema (nome,
              telefone, email, empresa, tags) ou cria um campo personalizado
              — nenhuma coluna é descartada.
            </DialogDescription>
          </DialogHeader>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ')
                fileInputRef.current?.click();
            }}
            className={cn(
              'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 transition-all',
              file
                ? 'border-primary/35 bg-primary/[0.04]'
                : 'hover:border-primary/40 border-border/80 bg-background/40 hover:bg-background/70'
            )}
          >
            {file ? (
              <>
                <div className="bg-primary/15 ring-primary/25 flex size-10 items-center justify-center rounded-lg ring-1">
                  <FileText className="text-primary size-5" />
                </div>
                <p
                  className="max-w-full truncate px-2 text-sm font-medium text-popover-foreground"
                  title={file.name}
                >
                  {truncateFilename(file.name)}
                </p>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {mappedRows.length} linha{mappedRows.length !== 1 ? 's' : ''}{' '}
                  pronta{mappedRows.length !== 1 ? 's' : ''}
                </span>
              </>
            ) : (
              <>
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted/80 ring-1 ring-border/80 transition-colors group-hover:bg-muted">
                  <Upload className="size-5 text-muted-foreground group-hover:text-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Clique para escolher um arquivo CSV
                </p>
                <p className="text-[11px] text-muted-foreground">
                  .csv até o limite do seu navegador
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {headers.length > 0 && !result && (
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  <Columns3 className="size-3.5" />
                  Mapeamento de colunas
                </div>
                <div className="space-y-1.5 rounded-xl border border-border p-2">
                  {headers.map((header, i) => (
                    <div
                      key={`${header}-${i}`}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1"
                    >
                      <span
                        className="max-w-[9rem] truncate font-mono text-[11px] text-muted-foreground"
                        title={header}
                      >
                        {header}
                      </span>
                      <Select
                        value={mappingToValue(mappings[i])}
                        onValueChange={(v) => v && handleMappingChange(i, v)}
                      >
                        <SelectTrigger className="h-8 w-48 bg-muted text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MAPPING_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.value === 'custom' && mappings[i]?.kind === 'custom'
                                ? `Campo personalizado: ${mappings[i].fieldName}`
                                : opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                {!hasPhoneMapped && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-400">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    Mapeie uma coluna para &quot;Telefone&quot; para poder importar.
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    Prévia · primeiras {preview.length}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tagStats.rowsWithTags > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/90 px-2 py-0.5 text-[11px] text-muted-foreground">
                        <Tag className="text-primary/80 size-3" />
                        {tagStats.unique} tag{tagStats.unique !== 1 ? 's' : ''} ·{' '}
                        {tagStats.rowsWithTags} contato
                        {tagStats.rowsWithTags !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-border ring-1 ring-border/50">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[36rem] text-xs">
                      <thead>
                        <tr className="border-b border-border bg-background/60">
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            Telefone
                          </th>
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            Nome
                          </th>
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            Email
                          </th>
                          {previewHasCompany && (
                            <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                              Empresa
                            </th>
                          )}
                          {previewHasTags && (
                            <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                              Tags
                            </th>
                          )}
                          {previewHasCustom && (
                            <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                              Campos personalizados
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {preview.map((row, i) => (
                          <tr
                            key={i}
                            className="bg-popover/40 transition-colors hover:bg-muted/30"
                          >
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                              <PreviewCell
                                value={row.phone}
                                mono
                                maxWidth="max-w-[7.5rem]"
                              />
                            </td>
                            <td className="px-3 py-2 text-popover-foreground">
                              <PreviewCell
                                value={row.name || '—'}
                                maxWidth="max-w-[8.5rem]"
                              />
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              <PreviewCell
                                value={row.email || '—'}
                                maxWidth="max-w-[10rem]"
                              />
                            </td>
                            {previewHasCompany && (
                              <td className="px-3 py-2 text-muted-foreground">
                                <PreviewCell
                                  value={row.company || '—'}
                                  maxWidth="max-w-[7rem]"
                                />
                              </td>
                            )}
                            {previewHasTags && (
                              <td className="px-3 py-2 align-top">
                                <ImportPreviewTags
                                  tagNames={row.tagNames}
                                  tagColorByKey={tagColorByKey}
                                />
                              </td>
                            )}
                            {previewHasCustom && (
                              <td className="px-3 py-2 align-top text-muted-foreground">
                                <ImportPreviewCustomValues values={row.customValues} />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {mappedRows.length > PREVIEW_LIMIT && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    + {mappedRows.length - PREVIEW_LIMIT} linha
                    {mappedRows.length - PREVIEW_LIMIT !== 1 ? 's' : ''} não exibida
                    {mappedRows.length - PREVIEW_LIMIT !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-border bg-background/50 p-4">
              <p className="text-sm font-medium text-popover-foreground">Importação concluída</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {result.imported > 0 && (
                  <div className="text-primary flex items-center gap-1.5 text-sm">
                    <CheckCircle className="size-4 shrink-0" />
                    {result.imported} importado{result.imported !== 1 ? 's' : ''}
                  </div>
                )}
                {result.tagsAssigned > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-cyan-400">
                    <CheckCircle className="size-4 shrink-0" />
                    {result.tagsAssigned} tag
                    {result.tagsAssigned !== 1 ? 's' : ''} aplicada{result.tagsAssigned !== 1 ? 's' : ''}
                  </div>
                )}
                {result.customValuesAssigned > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-violet-400">
                    <CheckCircle className="size-4 shrink-0" />
                    {result.customValuesAssigned} campo
                    {result.customValuesAssigned !== 1 ? 's' : ''} personalizado
                    {result.customValuesAssigned !== 1 ? 's' : ''}
                  </div>
                )}
                {result.skipped > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-400">
                    <AlertTriangle className="size-4 shrink-0" />
                    {result.skipped} ignorado{result.skipped !== 1 ? 's' : ''}
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-red-400">
                    <XCircle className="size-4 shrink-0" />
                    {result.failed} falhou{result.failed !== 1 ? 'aram' : ''}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-0 shrink-0 gap-2 border-t border-border/80 bg-background/50 px-6 py-4 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {result ? 'Fechar' : 'Cancelar'}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={mappedRows.length === 0 || !hasPhoneMapped || importing}
              onClick={handleImport}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              Importar {mappedRows.length > 0 ? mappedRows.length : ''} contato
              {mappedRows.length !== 1 ? 's' : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
