import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolveImportCustomFieldsResult {
  /** Lowercase field_name → custom_field id. */
  fieldIdByKey: Map<string, string>;
  /** Names that could not be matched and were not created. */
  skippedNames: string[];
}

/**
 * Resolve custom-field names from a CSV import's column mapping to
 * custom_fields ids. Existing account fields are matched case-
 * insensitively by field_name. Missing names are created (field_type
 * 'text') when `canCreateFields` is true (admin+, matches the RLS
 * insert policy on custom_fields — migration 017); otherwise they are
 * reported in `skippedNames` and that column's values are dropped.
 *
 * Mirrors resolve-import-tags.ts's resolve-or-create pattern.
 */
export async function resolveImportCustomFieldIds(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    userId: string;
    fieldNames: string[];
    canCreateFields: boolean;
  }
): Promise<ResolveImportCustomFieldsResult> {
  const { accountId, userId, fieldNames, canCreateFields } = params;

  const uniqueNames: string[] = [];
  const seen = new Set<string>();
  for (const raw of fieldNames) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNames.push(name);
  }

  if (uniqueNames.length === 0) {
    return { fieldIdByKey: new Map(), skippedNames: [] };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('custom_fields')
    .select('id, field_name')
    .eq('account_id', accountId);

  if (fetchError) throw fetchError;

  const fieldIdByKey = new Map<string, string>();
  for (const field of existing ?? []) {
    const key = field.field_name.trim().toLowerCase();
    if (!fieldIdByKey.has(key)) fieldIdByKey.set(key, field.id);
  }

  const skippedNames: string[] = [];
  const toCreate: string[] = [];

  for (const name of uniqueNames) {
    const key = name.toLowerCase();
    if (fieldIdByKey.has(key)) continue;
    if (canCreateFields) toCreate.push(name);
    else skippedNames.push(name);
  }

  if (toCreate.length > 0) {
    const { data: created, error: createError } = await supabase
      .from('custom_fields')
      .insert(
        toCreate.map((name) => ({
          user_id: userId,
          account_id: accountId,
          field_name: name,
          field_type: 'text',
        }))
      )
      .select('id, field_name');

    if (createError) throw createError;

    for (const field of created ?? []) {
      fieldIdByKey.set(field.field_name.trim().toLowerCase(), field.id);
    }
  }

  return { fieldIdByKey, skippedNames };
}

export interface ContactCustomFieldValue {
  contactId: string;
  /** field_name (lowercase key) → raw string value for that row. */
  values: Map<string, string>;
}

/**
 * Insert contact_custom_values rows for imported contacts. Blank values
 * are skipped (nothing meaningful to store), and any field name that
 * couldn't be resolved to an id (unresolvable + not admin) is silently
 * dropped for that row — the contact is still imported.
 */
export async function assignImportedCustomFieldValues(
  supabase: SupabaseClient,
  assignments: ContactCustomFieldValue[],
  fieldIdByKey: Map<string, string>
): Promise<number> {
  const rows: { contact_id: string; custom_field_id: string; value: string }[] = [];

  for (const { contactId, values } of assignments) {
    for (const [key, value] of values) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const fieldId = fieldIdByKey.get(key);
      if (!fieldId) continue;
      rows.push({ contact_id: contactId, custom_field_id: fieldId, value: trimmed });
    }
  }

  if (rows.length === 0) return 0;

  const chunkSize = 100;
  let assigned = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from('contact_custom_values').upsert(chunk, {
      onConflict: 'contact_id,custom_field_id',
    });
    if (error) throw error;
    assigned += chunk.length;
  }

  return assigned;
}
