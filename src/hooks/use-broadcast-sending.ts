'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Contact, MessageTemplate } from '@/types';
import type { VariableMapping } from '@/lib/broadcast-variables';
import type { CadenceSettings } from '@/lib/broadcast-cadence';

export type { VariableMapping };

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv' | 'pipeline_stage';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** For type === 'pipeline_stage': contacts with an open deal in this stage. */
  pipelineId?: string;
  stageId?: string;
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
  /** Anti-duplicate guard — subtract contacts who already have a
   *  broadcast_recipients row with status='sent' in the last
   *  `excludeRecentDays` days. */
  excludeRecentlyMessaged?: boolean;
  excludeRecentDays?: number;
}

/**
 * Contact ids that already received a broadcast template in the last
 * `days` days — the anti-duplicate exclusion for #8. RLS on
 * broadcast_recipients already scopes SELECT to the caller's account
 * (migration 017), so no explicit account_id filter is needed here,
 * matching every other query in this hook.
 */
export async function fetchRecentlyMessagedContactIds(
  supabase: ReturnType<typeof createClient>,
  days: number,
): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('broadcast_recipients')
    .select('contact_id')
    .eq('status', 'sent')
    .gte('sent_at', cutoff);
  if (error) {
    throw new Error(`Failed to check recently-messaged contacts: ${error.message}`);
  }
  return new Set(
    (data ?? [])
      .map((r) => r.contact_id as string | null)
      .filter((id): id is string => Boolean(id)),
  );
}

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  cadence: CadenceSettings;
  /** null = send immediately. */
  scheduledAt: Date | null;
}

interface UseBroadcastSendingReturn {
  createBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

/** `broadcast_recipients` inserts are independent of the send rate. */
const INSERT_BATCH_SIZE = 200;

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const t = useTranslations('broadcasts.new');
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
    const supabase = createClient();

    let contacts: Contact[] = [];

    if (audience.type === 'all') {
      const { data, error } = await supabase.from('contacts').select('*');
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = data ?? [];
    } else if (
      audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0
    ) {
      const { data: contactTags, error: tagError } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.tagIds);

      if (tagError)
        throw new Error(`Failed to fetch contact tags: ${tagError.message}`);

      if (contactTags && contactTags.length > 0) {
        const uniqueContactIds = [
          ...new Set(contactTags.map((ct) => ct.contact_id)),
        ];
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .in('id', uniqueContactIds);
        if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
        contacts = data ?? [];
      }
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(supabase, audience.customField);
    } else if (audience.type === 'csv' && audience.csvContacts) {
      contacts = await upsertCsvContacts(supabase, audience.csvContacts);
    } else if (audience.type === 'pipeline_stage' && audience.stageId) {
      contacts = await resolvePipelineStageAudience(supabase, audience.stageId);
    }

    // Apply exclude tags (works across all contact-derived audience
    // types). CSV contacts are synthetic so exclusion doesn't apply.
    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const { data: excludeRows } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.excludeTagIds);
      const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
      contacts = contacts.filter((c) => !excludedIds.has(c.id));
    }

    // Anti-duplicate guard — drop anyone who already received a
    // broadcast template recently, regardless of audience type.
    if (audience.excludeRecentlyMessaged && (audience.excludeRecentDays ?? 0) > 0) {
      const recentIds = await fetchRecentlyMessagedContactIds(
        supabase,
        audience.excludeRecentDays!,
      );
      contacts = contacts.filter((c) => !recentIds.has(c.id));
    }

    return contacts;
  }

  /**
   * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
   * can insert broadcast_recipients (whose contact_id FKs contacts.id),
   * we need real contacts.id UUIDs. So: look up each CSV phone in the
   * caller's contacts table; insert any that don't exist; return the
   * resolved set.
   */
  async function upsertCsvContacts(
    supabase: ReturnType<typeof createClient>,
    csvRows: { phone: string; name?: string }[],
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      throw new Error(t('notSignedIn'));
    }
    if (!accountId) {
      throw new Error(t('noAccountLinked'));
    }

    // De-duplicate by phone within the CSV (users can paste duplicates).
    const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      if (row.phone) uniqueByPhone.set(row.phone, row);
    }
    const phones = [...uniqueByPhone.keys()];

    // Single round-trip lookup of existing contacts by phone.
    const { data: existing, error: lookupErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', user.id)
      .in('phone', phones);
    if (lookupErr) {
      throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
    }

    const byPhone = new Map<string, Contact>();
    for (const c of (existing ?? []) as Contact[]) {
      if (c.phone) byPhone.set(c.phone, c);
    }

    // Insert only missing contacts, in one batch per 200 rows (PostgREST
    // has a default payload cap — 200 keeps individual requests small).
    const missing = phones
      .filter((p) => !byPhone.has(p))
      .map((phone) => ({
        user_id: user.id,
        account_id: accountId,
        phone,
        name: uniqueByPhone.get(phone)?.name ?? null,
      }));

    const INSERT_CHUNK = 200;
    for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
      const chunk = missing.slice(i, i + INSERT_CHUNK);
      const { data: inserted, error: insertErr } = await supabase
        .from('contacts')
        .insert(chunk)
        .select();
      if (insertErr) {
        throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
      }
      for (const c of (inserted ?? []) as Contact[]) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    // Preserve input order so analytics roughly matches the CSV order.
    return phones
      .map((p) => byPhone.get(p))
      .filter((c): c is Contact => Boolean(c));
  }

  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filter: CustomFieldFilter,
  ): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;

    // Build the WHERE clause for the operator. PostgREST supports
    // eq/neq/ilike via the query builder — use ilike with wildcards
    // for "contains" so the match is case-insensitive.
    let query = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);

    if (operator === 'is') query = query.eq('value', value);
    else if (operator === 'is_not') query = query.neq('value', value);
    else if (operator === 'contains') query = query.ilike('value', `%${value}%`);

    const { data: matches, error: matchErr } = await query;
    if (matchErr)
      throw new Error(`Custom-field filter failed: ${matchErr.message}`);

    const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
    if (contactIds.length === 0) return [];

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', contactIds);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    return data ?? [];
  }

  /** Contacts with an open deal sitting in the given pipeline stage. */
  async function resolvePipelineStageAudience(
    supabase: ReturnType<typeof createClient>,
    stageId: string,
  ): Promise<Contact[]> {
    const { data: matches, error: matchErr } = await supabase
      .from('deals')
      .select('contact_id')
      .eq('stage_id', stageId)
      .eq('status', 'open');
    if (matchErr) throw new Error(`Pipeline-stage filter failed: ${matchErr.message}`);

    const contactIds = [
      ...new Set(
        (matches ?? [])
          .map((m) => m.contact_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (contactIds.length === 0) return [];

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', contactIds);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    return data ?? [];
  }

  /**
   * Resolves the audience and writes `broadcasts` + `broadcast_recipients`
   * rows, then returns. The actual sending (with anti-ban cadence,
   * business-hours gating, and rate-limit backoff) happens server-side
   * in `/api/broadcasts/cron`, polled by an external scheduler — this
   * hook no longer drives the send loop itself, since a browser-side
   * loop can't survive the tab closing and can't honor multi-minute
   * inter-batch pauses without holding the tab open the whole time.
   */
  async function createBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    const supabase = createClient();

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        throw new Error(t('notSignedIn'));
      }
      if (!accountId) {
        throw new Error(t('noAccountLinked'));
      }

      setProgress(10);
      const contacts = await resolveAudience(payload.audience);
      if (contacts.length === 0) {
        throw new Error(t('noContactsFound'));
      }

      // Belt-and-braces dedup on top of the DB's unique index — audience
      // resolution shouldn't produce duplicate contact ids today, but a
      // future audience type combining multiple sources easily could.
      const uniqueContacts = [...new Map(contacts.map((c) => [c.id, c])).values()];

      setProgress(30);
      const startsNow = !payload.scheduledAt;
      const nextBatchAt = (payload.scheduledAt ?? new Date()).toISOString();

      const { data: broadcast, error: broadcastError } = await supabase
        .from('broadcasts')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: payload.name,
          template_name: payload.template.name,
          template_language: payload.template.language ?? 'en_US',
          template_variables: payload.variables,
          audience_filter: {
            type: payload.audience.type,
            tagIds: payload.audience.tagIds,
            customField: payload.audience.customField,
            pipelineId: payload.audience.pipelineId,
            stageId: payload.audience.stageId,
            excludeTagIds: payload.audience.excludeTagIds,
            excludeRecentlyMessaged: payload.audience.excludeRecentlyMessaged,
            excludeRecentDays: payload.audience.excludeRecentDays,
          },
          status: startsNow ? 'sending' : 'scheduled',
          scheduled_at: payload.scheduledAt?.toISOString() ?? null,
          next_batch_at: nextBatchAt,
          total_recipients: uniqueContacts.length,
          batch_size: payload.cadence.batchSize,
          batch_interval_minutes: payload.cadence.batchIntervalMinutes,
          message_delay_min_seconds: payload.cadence.messageDelayMinSeconds,
          message_delay_max_seconds: payload.cadence.messageDelayMaxSeconds,
          respect_business_hours: payload.cadence.respectBusinessHours,
          sent_count: 0,
          delivered_count: 0,
          read_count: 0,
          replied_count: 0,
          failed_count: 0,
        })
        .select()
        .single();

      if (broadcastError || !broadcast) {
        throw new Error(
          `Failed to create broadcast: ${broadcastError?.message ?? 'unknown error'}`,
        );
      }

      setProgress(50);
      const recipientRows = uniqueContacts.map((contact) => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        status: 'pending' as const,
      }));

      for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
        const { error: recipientError } = await supabase
          .from('broadcast_recipients')
          .insert(batch);
        if (recipientError) {
          // Previous impl logged and marched on — the broadcast then ran
          // with an incomplete recipient set, so webhook status updates
          // couldn't find some rows and the aggregate counts drifted.
          // Flip the broadcast to failed so the user sees the problem
          // immediately, then throw to abort.
          await supabase
            .from('broadcasts')
            .update({
              status: 'failed',
              failed_count: uniqueContacts.length,
            })
            .eq('id', broadcast.id);
          throw new Error(
            `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${recipientError.message}`,
          );
        }
        setProgress(50 + Math.round(((i + batch.length) / recipientRows.length) * 50));
      }

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createBroadcast, isProcessing, progress };
}
