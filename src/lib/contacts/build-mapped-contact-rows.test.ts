import { describe, expect, it } from 'vitest';
import { buildMappedContactRows } from './build-mapped-contact-rows';
import type { ColumnMapping } from './parse-csv-generic';

describe('buildMappedContactRows', () => {
  const mappings: ColumnMapping[] = [
    { kind: 'system', field: 'name' },
    { kind: 'system', field: 'phone' },
    { kind: 'custom', fieldName: 'cpf' },
    { kind: 'ignore' },
  ];

  it('applies the mapping and buckets unmapped columns as custom values', () => {
    const rows = buildMappedContactRows(
      [['Alice', '+15551234567', '123.456.789-00', 'noise']],
      mappings
    );
    expect(rows).toEqual([
      {
        phone: '+15551234567',
        name: 'Alice',
        email: undefined,
        company: undefined,
        tagNames: [],
        customValues: new Map([['cpf', '123.456.789-00']]),
      },
    ]);
  });

  it('drops rows with no phone value', () => {
    const rows = buildMappedContactRows([['Bob', '', '', '']], mappings);
    expect(rows).toEqual([]);
  });

  it('returns nothing when no column is mapped to phone', () => {
    const noPhone: ColumnMapping[] = [{ kind: 'system', field: 'name' }, { kind: 'ignore' }];
    const rows = buildMappedContactRows([['Alice', 'x']], noPhone);
    expect(rows).toEqual([]);
  });
});
