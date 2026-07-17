'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { CustomField, Pipeline, PipelineStage, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import { parseContactCsv } from '@/lib/contacts/parse-contact-csv';
import { isValidE164, normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  Users,
  Tags,
  Filter,
  Upload,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
  FileText,
  AlertTriangle,
  Clock,
  GitBranch,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchRecentlyMessagedContactIds } from '@/hooks/use-broadcast-sending';

type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv' | 'pipeline_stage';
type CustomFieldOperator = 'is' | 'is_not' | 'contains';

interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** For type === 'pipeline_stage': contacts with an open deal in this stage. */
  pipelineId?: string;
  stageId?: string;
  /** For type === 'pipeline_stage': further narrows to contacts that also
   *  carry ANY of these tags — e.g. "Leads na etapa Qualificado COM tag
   *  Servidor Municipal". Optional refinement, not required for validity. */
  stageTagIds?: string[];
  excludeTagIds?: string[];
  /** Anti-duplicate guard — see #8: subtract contacts who already have a
   *  broadcast_recipients row with status='sent' in the last N days. */
  excludeRecentlyMessaged?: boolean;
  excludeRecentDays?: number;
}

const DEFAULT_EXCLUDE_RECENT_DAYS = 7;

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

const audienceOptions: {
  type: AudienceType;
  labelKey: string;
  descriptionKey: string;
  icon: typeof Users;
}[] = [
  {
    type: 'all',
    labelKey: 'allContacts',
    descriptionKey: 'allContactsDescription',
    icon: Users,
  },
  {
    type: 'tags',
    labelKey: 'filterByTags',
    descriptionKey: 'filterByTagsDescription',
    icon: Tags,
  },
  {
    type: 'custom_field',
    labelKey: 'customField',
    descriptionKey: 'customFieldDescription',
    icon: Filter,
  },
  {
    type: 'csv',
    labelKey: 'uploadCsv',
    descriptionKey: 'uploadCsvDescription',
    icon: Upload,
  },
  {
    type: 'pipeline_stage',
    labelKey: 'filterByStage',
    descriptionKey: 'filterByStageDescription',
    icon: GitBranch,
  },
];

const OPERATOR_OPTIONS: { value: CustomFieldOperator; labelKey: string }[] = [
  { value: 'is', labelKey: 'operatorIs' },
  { value: 'is_not', labelKey: 'operatorIsNot' },
  { value: 'contains', labelKey: 'operatorContains' },
];

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const t = useTranslations('broadcasts.step2');
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [loadingPipelines, setLoadingPipelines] = useState(false);
  const [loadingPipelineStages, setLoadingPipelineStages] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [excludedRecentCount, setExcludedRecentCount] = useState(0);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvInvalidCount, setCsvInvalidCount] = useState(0);
  const [csvError, setCsvError] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Tags are used both by the primary "Filter by Tags" audience type
  // AND by the exclude-list below — so always load once on mount.
  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags(data ?? []);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  // Lazy-load custom fields only when that audience type is active.
  useEffect(() => {
    if (audience.type !== 'custom_field') return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('custom_fields')
          .select('*')
          .order('field_name');
        setCustomFields(data ?? []);
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audience.type]);

  // Lazy-load pipelines only when that audience type is active.
  useEffect(() => {
    if (audience.type !== 'pipeline_stage') return;
    async function fetchPipelines() {
      setLoadingPipelines(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('pipelines')
          .select('*')
          .order('created_at');
        setPipelines(data ?? []);
      } finally {
        setLoadingPipelines(false);
      }
    }
    fetchPipelines();
  }, [audience.type]);

  // Stages for the selected pipeline — reloads whenever the user picks
  // a different pipeline within the "filter by stage" audience type.
  useEffect(() => {
    if (audience.type !== 'pipeline_stage' || !audience.pipelineId) {
      setPipelineStages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingPipelineStages(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('pipeline_stages')
          .select('*')
          .eq('pipeline_id', audience.pipelineId)
          .order('position');
        if (!cancelled) setPipelineStages(data ?? []);
      } finally {
        if (!cancelled) setLoadingPipelineStages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audience.type, audience.pipelineId]);

  // Guards against out-of-order responses: toggling tags/type quickly can
  // fire several overlapping fetches (the "all contacts" branch in
  // particular is much slower than a tag-scoped query), and without this
  // an earlier, slower response can resolve after a newer one and clobber
  // the count with a stale value. Mirrors the same guard on the Contacts
  // page's fetchContacts.
  const countFetchSeq = useRef(0);

  const fetchEstimatedCount = useCallback(async () => {
    const seq = ++countFetchSeq.current;
    setLoadingCount(true);
    setExcludedRecentCount(0);
    try {
      const supabase = createClient();

      // Base query — produces the superset before exclude is applied.
      let baseIds: Set<string> | null = null; // null means "all contacts"

      if (audience.type === 'all') {
        // Handled below — full-table count adjusted by excludes.
      } else if (
        audience.type === 'tags' &&
        audience.tagIds &&
        audience.tagIds.length > 0
      ) {
        const { data } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', audience.tagIds);
        baseIds = new Set((data ?? []).map((r) => r.contact_id));
      } else if (
        audience.type === 'custom_field' &&
        audience.customField?.fieldId &&
        audience.customField.value
      ) {
        const { fieldId, operator, value } = audience.customField;
        let q = supabase
          .from('contact_custom_values')
          .select('contact_id')
          .eq('custom_field_id', fieldId);
        if (operator === 'is') q = q.eq('value', value);
        else if (operator === 'is_not') q = q.neq('value', value);
        else q = q.ilike('value', `%${value}%`);
        const { data } = await q;
        baseIds = new Set((data ?? []).map((r) => r.contact_id));
      } else if (
        audience.type === 'csv' &&
        audience.csvContacts &&
        audience.csvContacts.length > 0
      ) {
        // CSV rows are raw phone numbers, not contact ids yet (those are
        // only created at send time — see upsertCsvContacts), so the
        // recent-exclusion guard can only catch phones that already match
        // an existing contact.
        if (audience.excludeRecentlyMessaged && (audience.excludeRecentDays ?? 0) > 0) {
          const phones = audience.csvContacts.map((c) => c.phone);
          const { data: existing } = await supabase
            .from('contacts')
            .select('id, phone')
            .in('phone', phones);
          const idByPhone = new Map(
            (existing ?? []).map((c) => [c.phone, c.id]),
          );
          const recentIds = await fetchRecentlyMessagedContactIds(
            supabase,
            audience.excludeRecentDays!,
          );
          if (seq !== countFetchSeq.current) return;
          const excludedForRecent = audience.csvContacts.filter((c) => {
            const id = idByPhone.get(c.phone);
            return id ? recentIds.has(id) : false;
          }).length;
          setExcludedRecentCount(excludedForRecent);
          setEstimatedCount(audience.csvContacts.length - excludedForRecent);
        } else {
          setEstimatedCount(audience.csvContacts.length);
        }
        return;
      } else if (audience.type === 'pipeline_stage' && audience.stageId) {
        const { data } = await supabase
          .from('deals')
          .select('contact_id')
          .eq('stage_id', audience.stageId)
          .eq('status', 'open');
        baseIds = new Set(
          (data ?? [])
            .map((r) => r.contact_id as string | null)
            .filter((id): id is string => Boolean(id)),
        );
        if (audience.stageTagIds && audience.stageTagIds.length > 0) {
          const { data: stageTagRows } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.stageTagIds);
          const stageTagContactIds = new Set((stageTagRows ?? []).map((r) => r.contact_id));
          baseIds = new Set([...baseIds].filter((id) => stageTagContactIds.has(id)));
        }
      } else {
        // Partially-configured audience — wait for the user to finish.
        setEstimatedCount(null);
        return;
      }

      // Apply exclude tags
      let excludeSet: Set<string> | null = null;
      if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
        const { data: excludeRows } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', audience.excludeTagIds);
        excludeSet = new Set((excludeRows ?? []).map((r) => r.contact_id));
      }

      // Anti-duplicate guard (#8) — only meaningful once we know the
      // effective (pre-recent-exclusion) id set, so it's computed here
      // rather than folded into excludeSet above.
      let recentIds: Set<string> | null = null;
      if (audience.excludeRecentlyMessaged && (audience.excludeRecentDays ?? 0) > 0) {
        recentIds = await fetchRecentlyMessagedContactIds(
          supabase,
          audience.excludeRecentDays!,
        );
      }

      // A newer call to fetchEstimatedCount has since started (the user
      // toggled another tag/type while this one was still in flight) —
      // let that one own the final setEstimatedCount instead of clobbering
      // it with this stale result.
      if (seq !== countFetchSeq.current) return;

      if (baseIds) {
        const afterTagExclude = [...baseIds].filter((id) => !excludeSet?.has(id));
        const excludedForRecent = recentIds
          ? afterTagExclude.filter((id) => recentIds!.has(id)).length
          : 0;
        setExcludedRecentCount(excludedForRecent);
        const effective = recentIds
          ? afterTagExclude.filter((id) => !recentIds!.has(id))
          : afterTagExclude;
        setEstimatedCount(effective.length);
      } else {
        // "All" — fetch every contact id so the recent-exclusion count
        // can be computed precisely (a head-count query can't tell us
        // which ids overlap with recentIds).
        const { data: allContacts, count } = await supabase
          .from('contacts')
          .select('id', { count: 'exact' });
        const ids = (allContacts ?? []).map((c) => c.id);
        const afterTagExclude = excludeSet
          ? ids.filter((id) => !excludeSet!.has(id))
          : ids;
        const excludedForRecent = recentIds
          ? afterTagExclude.filter((id) => recentIds!.has(id)).length
          : 0;
        setExcludedRecentCount(excludedForRecent);
        const total = count ?? ids.length;
        const afterTagCount = excludeSet ? afterTagExclude.length : total;
        setEstimatedCount(Math.max(0, afterTagCount - excludedForRecent));
      }
    } finally {
      if (seq === countFetchSeq.current) setLoadingCount(false);
    }
  }, [
    audience.type,
    audience.tagIds,
    audience.customField,
    audience.csvContacts,
    audience.stageId,
    audience.stageTagIds,
    audience.excludeRecentlyMessaged,
    audience.excludeRecentDays,
    audience.excludeTagIds,
  ]);

  useEffect(() => {
    fetchEstimatedCount();
  }, [fetchEstimatedCount]);

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function toggleStageTag(tagId: string) {
    const current = audience.stageTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, stageTagIds: updated });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  function updateCustomField(patch: Partial<CustomFieldFilter>) {
    const prev = audience.customField ?? {
      fieldId: '',
      operator: 'is' as CustomFieldOperator,
      value: '',
    };
    onUpdate({ ...audience, customField: { ...prev, ...patch } });
  }

  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setCsvFileName(selected.name);
    setCsvError(null);
    setCsvInvalidCount(0);

    const text = await selected.text();
    const { rows } = parseContactCsv(text);

    if (rows.length === 0) {
      setCsvError(t('csvNoHeaderError'));
      onUpdate({ ...audience, csvContacts: [] });
      return;
    }

    let invalid = 0;
    const seen = new Set<string>();
    const contacts: { phone: string; name?: string }[] = [];

    for (const row of rows) {
      const normalized = normalizePhone(row.phone);
      if (!isValidE164(normalized)) {
        invalid++;
        continue;
      }
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      contacts.push({ phone: row.phone, name: row.name });
    }

    setCsvInvalidCount(invalid);
    onUpdate({ ...audience, csvContacts: contacts });
  }

  const isValid =
    audience.type === 'all' ||
    (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) ||
    (audience.type === 'custom_field' &&
      !!audience.customField?.fieldId &&
      audience.customField.value.length > 0) ||
    (audience.type === 'csv' &&
      audience.csvContacts &&
      audience.csvContacts.length > 0) ||
    (audience.type === 'pipeline_stage' && !!audience.pipelineId && !!audience.stageId);

  const selectedStageName = pipelineStages.find((s) => s.id === audience.stageId)?.name;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceOptions.map((option) => {
          const isSelected = audience.type === option.type;
          const Icon = option.icon;
          return (
            <button
              key={option.type}
              onClick={() => {
                if (option.type !== 'csv') {
                  setCsvFileName(null);
                  setCsvInvalidCount(0);
                  setCsvError(null);
                  if (csvInputRef.current) csvInputRef.current.value = '';
                }
                onUpdate({
                  ...audience,
                  type: option.type,
                  // Wipe shape fields from other types to avoid stale
                  // config leaking across selections.
                  tagIds: option.type === 'tags' ? audience.tagIds : undefined,
                  customField:
                    option.type === 'custom_field'
                      ? audience.customField
                      : undefined,
                  csvContacts:
                    option.type === 'csv' ? audience.csvContacts : undefined,
                  pipelineId:
                    option.type === 'pipeline_stage' ? audience.pipelineId : undefined,
                  stageId:
                    option.type === 'pipeline_stage' ? audience.stageId : undefined,
                  stageTagIds:
                    option.type === 'pipeline_stage' ? audience.stageTagIds : undefined,
                });
              }}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border bg-card/50 hover:border-border'
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  isSelected
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{t(option.labelKey)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t(option.descriptionKey)}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {audience.type === 'tags' && (
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">{t('selectTags')}</p>
          {loadingTags ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('noTagsFound')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-muted text-muted-foreground hover:border-border'
                    }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {audience.type === 'custom_field' && (
        <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm font-medium text-foreground">{t('customFieldFilter')}</p>
          {loadingFields ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : customFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('noCustomFieldsHint')}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
              <select
                value={audience.customField?.fieldId ?? ''}
                onChange={(e) => updateCustomField({ fieldId: e.target.value })}
                className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">{t('selectFieldPlaceholder')}</option>
                {customFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.field_name}
                  </option>
                ))}
              </select>
              <select
                value={audience.customField?.operator ?? 'is'}
                onChange={(e) =>
                  updateCustomField({
                    operator: e.target.value as CustomFieldOperator,
                  })
                }
                className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                {OPERATOR_OPTIONS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {t(op.labelKey)}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={audience.customField?.value ?? ''}
                onChange={(e) => updateCustomField({ value: e.target.value })}
                placeholder={t('valuePlaceholder')}
                className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
        </div>
      )}

      {audience.type === 'csv' && (
        <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm font-medium text-foreground">{t('uploadCsv')}</p>

          <div
            role="button"
            tabIndex={0}
            onClick={() => csvInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ')
                csvInputRef.current?.click();
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 text-center transition-all ${
              csvFileName
                ? 'border-primary/35 bg-primary/[0.04]'
                : 'border-border bg-background/40 hover:border-primary/40'
            }`}
          >
            {csvFileName ? (
              <>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <p className="max-w-full truncate px-2 text-sm font-medium text-foreground">
                  {csvFileName}
                </p>
              </>
            ) : (
              <>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">{t('csvUploadPrompt')}</p>
              </>
            )}
            <p className="text-xs text-muted-foreground">{t('csvUploadHint')}</p>
          </div>

          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvFile}
            className="hidden"
          />

          {csvError && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{csvError}</span>
            </div>
          )}

          {!csvError && audience.csvContacts && audience.csvContacts.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-primary">
              <Users className="h-3.5 w-3.5 shrink-0" />
              <span>
                {t('csvContactsFound', { count: audience.csvContacts.length })}
              </span>
            </div>
          )}

          {!csvError && csvFileName && (audience.csvContacts?.length ?? 0) === 0 && (
            <div className="flex items-center gap-2 text-xs text-gold">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{t('csvNoValidRows')}</span>
            </div>
          )}

          {csvInvalidCount > 0 && (
            <div className="flex items-center gap-2 text-xs text-gold">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{t('csvInvalidNumbers', { count: csvInvalidCount })}</span>
            </div>
          )}
        </div>
      )}

      {audience.type === 'pipeline_stage' && (
        <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm font-medium text-foreground">{t('stageFilter')}</p>
          {loadingPipelines ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : pipelines.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('noPipelinesFound')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                value={audience.pipelineId ?? ''}
                onChange={(e) =>
                  onUpdate({
                    ...audience,
                    pipelineId: e.target.value,
                    stageId: undefined,
                    stageTagIds: undefined,
                  })
                }
                className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">{t('selectPipelinePlaceholder')}</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={audience.stageId ?? ''}
                onChange={(e) =>
                  onUpdate({ ...audience, stageId: e.target.value, stageTagIds: undefined })
                }
                disabled={!audience.pipelineId || loadingPipelineStages}
                className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
              >
                <option value="">{t('selectStagePlaceholder')}</option>
                {pipelineStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {audience.stageId && (
            <div className="border-t border-border pt-3">
              <div className="mb-2 flex items-center gap-2">
                <p className="text-xs font-medium text-foreground">{t('stageTagFilterLabel')}</p>
                <span className="text-xs text-muted-foreground">{t('stageTagFilterOptional')}</span>
              </div>
              {tags.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('noTagsForStageFilter')}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const isSelected = audience.stageTagIds?.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => toggleStageTag(tag.id)}
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                          isSelected
                            ? 'border-primary/30 bg-primary/10 text-primary'
                            : 'border-border bg-muted text-muted-foreground hover:border-border'
                        }`}
                      >
                        <span
                          className="mr-1.5 h-2 w-2 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Exclude list — applies regardless of audience type */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <X className="h-4 w-4 text-destructive" />
          <p className="text-sm font-medium text-foreground">
            {t('excludeTagsLabel')}
          </p>
          <span className="text-xs text-muted-foreground">{t('optional')}</span>
        </div>
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('noTagsAvailable')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isExcluded = audience.excludeTagIds?.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleExcludeTag(tag.id)}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    isExcluded
                      ? 'border-destructive/30 bg-destructive/10 text-destructive'
                      : 'border-border bg-muted text-muted-foreground hover:border-border'
                  }`}
                >
                  <span
                    className="mr-1.5 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Anti-duplicate guard (#8) — applies regardless of audience type,
          CSV included: send-time resolution (use-broadcast-sending.ts)
          matches CSV phones to existing contacts before applying it. */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <label className="flex items-start gap-3">
          <Checkbox
            checked={!!audience.excludeRecentlyMessaged}
            onCheckedChange={(checked) =>
              onUpdate({
                ...audience,
                excludeRecentlyMessaged: !!checked,
                excludeRecentDays:
                  audience.excludeRecentDays ?? DEFAULT_EXCLUDE_RECENT_DAYS,
              })
            }
            className="mt-0.5"
          />
          <span className="flex-1">
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {t('excludeRecentLabel')}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t('excludeRecentDescription')}
            </span>
          </span>
        </label>
        {audience.excludeRecentlyMessaged && (
          <div className="mt-3 flex items-center gap-2 pl-7">
            <span className="text-sm text-muted-foreground">{t('excludeRecentDaysPrefix')}</span>
            <input
              type="number"
              min={1}
              value={audience.excludeRecentDays ?? DEFAULT_EXCLUDE_RECENT_DAYS}
              onChange={(e) =>
                onUpdate({
                  ...audience,
                  excludeRecentDays: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="h-8 w-20 rounded-lg border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <span className="text-sm text-muted-foreground">{t('excludeRecentDaysSuffix')}</span>
          </div>
        )}
      </div>

      {/* Audience Summary */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <p className="mb-2 text-sm font-medium text-foreground">{t('audienceSummary')}</p>
        {loadingCount ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">{t('calculating')}</span>
          </div>
        ) : estimatedCount !== null ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              {audience.type === 'pipeline_stage' && selectedStageName ? (
                <span className="text-sm text-foreground">
                  {t('contactsInStage', {
                    count: estimatedCount,
                    stage: selectedStageName,
                  })}
                </span>
              ) : (
                <>
                  <span className="font-mono text-sm text-foreground">
                    {estimatedCount.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">{t('estimatedRecipients')}</span>
                </>
              )}
            </div>
            {excludedRecentCount > 0 && (
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-gold" />
                <span className="text-xs text-gold">
                  {t('excludedRecentCount', { count: excludedRecentCount })}
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('selectAudienceTypeHint')}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
