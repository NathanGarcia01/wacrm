import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 *
 * Shared between the wizard (client, resolves for the preview + the
 * legacy sync path) and the broadcast cron worker (server, resolves
 * per-recipient at actual send time) — moved out of
 * use-broadcast-sending.ts so a 'use client' hook file isn't the only
 * place this logic lives.
 */
/**
 * `default` (migration 114) — used when the resolved value is blank
 * (e.g. a contact with no `name`, or no value for that custom field).
 * Lets a campaign creator pick e.g. "cliente" as a fallback so a
 * missing field never reaches Meta as an empty template parameter
 * (which Meta rejects with "(#131008) Required parameter is
 * missing"). Meaningless for `static` (always has a value) but kept
 * on the shared type so the resolver doesn't need per-variant checks.
 */
export type VariableMapping =
  | { type: 'static'; value: string; default?: string }
  | { type: 'field'; value: string; default?: string }
  | { type: 'custom_field'; value: string; default?: string };

/** contactId → (customFieldId → value). */
export type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
/**
 * Loosely typed so it accepts both the client's `Contact` rows
 * (optional string fields, no null) and the cron worker's raw
 * Postgres rows (required fields, nullable) without either caller
 * needing to reshape data first.
 */
export interface VariableSourceContact {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
}

function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Splits a contact's full name into properly-cased first/last/full
 * variants for template personalization — e.g. "JOÃO SILVA" → first
 * "João", last "Silva", full "João Silva". Whitespace-only or empty
 * input yields empty strings throughout rather than throwing, since
 * `contact.name` is optional and broadcasts must not crash on a
 * contact who never set one.
 */
export function extractNameParts(fullName: string | null | undefined) {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: capitalize(parts[0] || ''),
    lastName: capitalize(parts[parts.length - 1] || ''),
    fullName: parts.map(capitalize).join(' '),
  };
}

// Keys are typically "1","2",... — numeric-aware sort keeps
// {{1}} before {{10}}.
function sortVariableKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });
}

/** Resolves one mapping's raw value, with no default applied. */
function resolveRaw(
  v: VariableMapping,
  contact: VariableSourceContact,
  customValues?: Map<string, string>,
): string {
  if (v.type === 'static') return v.value;

  if (v.type === 'field') {
    const { firstName, lastName, fullName } = extractNameParts(contact.name);
    const fieldMap: Record<string, string | null | undefined> = {
      name: fullName,
      first_name: firstName,
      last_name: lastName,
      phone: contact.phone,
      email: contact.email,
      company: contact.company,
    };
    return fieldMap[v.value] ?? '';
  }

  // custom_field
  return customValues?.get(v.value) ?? '';
}

/**
 * Resolves a single mapping to its final send-time value — the raw
 * value if non-blank, otherwise `default` (migration 114), otherwise
 * an empty string. Used for body variables, the header-text variable,
 * and dynamic URL-button variables alike, since all three now share
 * the same `VariableMapping` shape.
 */
export function resolveSingleVariable(
  v: VariableMapping,
  contact: VariableSourceContact,
  customValues?: Map<string, string>,
): string {
  const raw = resolveRaw(v, contact, customValues);
  if (raw.trim()) return raw;
  return v.default?.trim() ? v.default : '';
}

export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: VariableSourceContact,
  customValues?: Map<string, string>,
): string[] {
  const keys = sortVariableKeys(Object.keys(variables));
  return keys.map((key) => resolveSingleVariable(variables[key], contact, customValues));
}

/**
 * Lists the keys (sorted, "1","2",… for body; "header"/"button:N" for
 * the others) that would still resolve to an empty string for this
 * contact even after applying each mapping's `default` — i.e. what
 * would reach Meta as an empty parameter and trigger "(#131008)
 * Required parameter is missing". Used both by the wizard's pre-send
 * validation (block "Iniciar" with a count) and could be reused for a
 * live per-recipient audit.
 */
export function findUnfilledVariableKeys(
  config: {
    body?: Record<string, VariableMapping>;
    header?: VariableMapping | null;
    buttons?: Record<string, VariableMapping>;
  },
  contact: VariableSourceContact,
  customValues?: Map<string, string>,
): string[] {
  const unfilled: string[] = [];

  const bodyKeys = sortVariableKeys(Object.keys(config.body ?? {}));
  for (const key of bodyKeys) {
    const value = resolveSingleVariable(config.body![key], contact, customValues);
    if (!value.trim()) unfilled.push(key);
  }

  if (config.header) {
    const value = resolveSingleVariable(config.header, contact, customValues);
    if (!value.trim()) unfilled.push('header');
  }

  for (const key of Object.keys(config.buttons ?? {})) {
    const value = resolveSingleVariable(config.buttons![key], contact, customValues);
    if (!value.trim()) unfilled.push(`button:${key}`);
  }

  return unfilled;
}

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value. Works with either the
 * browser client or a service-role client — both are `SupabaseClient`.
 */
export async function fetchCustomValueIndex(
  supabase: SupabaseClient,
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  // Supabase PostgREST caps the .in(...) IN-clause roughly at 1000
  // values. Page through to stay safe.
  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { data } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', slice);

    for (const row of data ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}
