import { parseTagCell } from './parse-contact-csv';
import type { ColumnMapping } from './parse-csv-generic';

export interface MappedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  tagNames: string[];
  /** Lowercase custom field name → raw cell value for this row. */
  customValues: Map<string, string>;
}

/**
 * Applies a column mapping (from the import wizard's mapping step) to
 * raw CSV rows, producing the same row shape the importer already knows
 * how to insert — plus a bucket of custom-field values per row so no
 * column (cpf, cidade, ...) is silently dropped.
 *
 * Rows without a resolvable phone value are dropped — phone is the
 * dedupe/insert key downstream.
 */
export function buildMappedContactRows(
  rawRows: string[][],
  mappings: ColumnMapping[]
): MappedContactRow[] {
  const phoneIdx = mappings.findIndex((m) => m.kind === 'system' && m.field === 'phone');
  if (phoneIdx === -1) return [];

  const idxOf = (field: 'name' | 'email' | 'company' | 'tags') =>
    mappings.findIndex((m) => m.kind === 'system' && m.field === field);
  const nameIdx = idxOf('name');
  const emailIdx = idxOf('email');
  const companyIdx = idxOf('company');
  const tagsIdx = idxOf('tags');

  const customCols = mappings
    .map((m, i) => ({ m, i }))
    .filter(
      (x): x is { m: Extract<ColumnMapping, { kind: 'custom' }>; i: number } =>
        x.m.kind === 'custom'
    );

  const rows: MappedContactRow[] = [];

  for (const raw of rawRows) {
    const phone = raw[phoneIdx]?.trim();
    if (!phone) continue;

    const customValues = new Map<string, string>();
    for (const { m, i } of customCols) {
      const value = raw[i]?.trim();
      if (value) customValues.set(m.fieldName.trim().toLowerCase(), value);
    }

    rows.push({
      phone,
      name: nameIdx >= 0 ? raw[nameIdx]?.trim() || undefined : undefined,
      email: emailIdx >= 0 ? raw[emailIdx]?.trim() || undefined : undefined,
      company: companyIdx >= 0 ? raw[companyIdx]?.trim() || undefined : undefined,
      tagNames: tagsIdx >= 0 ? parseTagCell(raw[tagsIdx]) : [],
      customValues,
    });
  }

  return rows;
}
