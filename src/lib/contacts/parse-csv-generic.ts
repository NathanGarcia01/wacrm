/**
 * Generic CSV parsing for the contacts import column-mapping step.
 *
 * Unlike parse-contact-csv.ts (which expects a fixed `phone` header),
 * this keeps whatever headers the file actually has so the UI can let
 * the user map each column to a system field or a custom field.
 */

export interface ParsedCsvGeneric {
  /** Raw header cells, in file order, trimmed but otherwise untouched
   *  (original casing preserved for display + custom field naming). */
  headers: string[];
  /** Raw cell values per row, same column order as `headers`. */
  rows: string[][];
}

export function parseCsvGeneric(text: string): ParsedCsvGeneric {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/["']/g, '').trim());

  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line).map((v) => v.replace(/["']/g, '').trim());
    rows.push(values);
  }

  return { headers, rows };
}

/** Simple CSV line parse (handles quoted fields) — same algorithm as
 *  parse-contact-csv.ts's private helper, kept in sync intentionally. */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

export type SystemFieldMapping = 'phone' | 'name' | 'email' | 'company' | 'tags';
export type ColumnMapping =
  | { kind: 'system'; field: SystemFieldMapping }
  | { kind: 'custom'; fieldName: string }
  | { kind: 'ignore' };

const HEADER_ALIASES: Record<SystemFieldMapping, string[]> = {
  phone: ['phone', 'telefone', 'celular', 'whatsapp', 'numero', 'número'],
  name: ['name', 'nome'],
  email: ['email', 'e-mail'],
  company: ['company', 'empresa'],
  tags: ['tags', 'tag', 'etiquetas'],
};

function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** Auto-suggests a mapping for each header — known aliases map to their
 *  system field; anything else defaults to a custom field named after
 *  the column, so no column is silently dropped. */
export function suggestColumnMappings(headers: string[]): ColumnMapping[] {
  const used = new Set<SystemFieldMapping>();
  return headers.map((header) => {
    const normalized = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [
      SystemFieldMapping,
      string[],
    ][]) {
      if (used.has(field)) continue;
      if (aliases.includes(normalized)) {
        used.add(field);
        return { kind: 'system', field };
      }
    }
    return { kind: 'custom', fieldName: header };
  });
}
