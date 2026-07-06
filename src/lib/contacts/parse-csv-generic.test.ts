import { describe, expect, it } from 'vitest';
import { parseCsvGeneric, suggestColumnMappings } from './parse-csv-generic';

describe('parseCsvGeneric', () => {
  it('keeps arbitrary headers and raw row values', () => {
    const csv = `nome,telefone,cpf,cidade
Alice,+15551234567,123.456.789-00,São Paulo`;

    expect(parseCsvGeneric(csv)).toEqual({
      headers: ['nome', 'telefone', 'cpf', 'cidade'],
      rows: [['Alice', '+15551234567', '123.456.789-00', 'São Paulo']],
    });
  });

  it('returns empty when the file has no data rows', () => {
    expect(parseCsvGeneric('phone')).toEqual({ headers: [], rows: [] });
  });
});

describe('suggestColumnMappings', () => {
  it('maps known aliases to system fields and unknown headers to custom fields', () => {
    const mappings = suggestColumnMappings(['Nome', 'Telefone', 'cpf', 'Cidade']);
    expect(mappings).toEqual([
      { kind: 'system', field: 'name' },
      { kind: 'system', field: 'phone' },
      { kind: 'custom', fieldName: 'cpf' },
      { kind: 'custom', fieldName: 'Cidade' },
    ]);
  });

  it('only assigns a system field to the first matching column', () => {
    const mappings = suggestColumnMappings(['phone', 'telefone']);
    expect(mappings).toEqual([
      { kind: 'system', field: 'phone' },
      { kind: 'custom', fieldName: 'telefone' },
    ]);
  });
});
