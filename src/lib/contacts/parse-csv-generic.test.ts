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

  it('maps "nome_completo" to name when there is no other name column', () => {
    const mappings = suggestColumnMappings(['telefone', 'nome_completo', 'cpf', 'cidade']);
    expect(mappings).toEqual([
      { kind: 'system', field: 'phone' },
      { kind: 'system', field: 'name' },
      { kind: 'custom', fieldName: 'cpf' },
      { kind: 'custom', fieldName: 'cidade' },
    ]);
  });

  it('does not double-claim "name" when both nome and nome_completo are present', () => {
    const mappings = suggestColumnMappings(['nome', 'nome_completo', 'telefone']);
    expect(mappings).toEqual([
      { kind: 'system', field: 'name' },
      { kind: 'custom', fieldName: 'nome_completo' },
      { kind: 'system', field: 'phone' },
    ]);
  });
});
