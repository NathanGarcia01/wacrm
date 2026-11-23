import { describe, expect, it } from 'vitest';

import { captureLead, type LeadSourceConfig } from './capture';

// ============================================================
// A minimal in-memory fake of the Supabase query-builder surface
// `captureLead` actually calls: select/insert/update with chained
// `.eq()`, a `.like()` that's a pass-through (the real `phonesMatch`
// filter in `@/lib/contacts/dedupe` does the precise narrowing after
// the fetch — this fake only needs to return a candidate superset),
// `.limit()`, and both `.maybeSingle()`/`.single()` terminals plus a
// bare `await` on the builder itself (dedupe.ts's `findExistingContact`
// never calls `.maybeSingle()` — it awaits the builder directly, so
// the builder must be thenable).
// ============================================================

interface Row {
  [key: string]: unknown;
}

function makeTable(rows: Row[], nextId: () => string, insertDefaults: Row = {}) {
  function select() {
    const filters: Array<(r: Row) => boolean> = [];
    const builder = {
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      // Extra args from the real call sites (`.like(col, pattern)`,
      // `.limit(n)`) are simply ignored — see module comment above.
      like() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle: async () => {
        const found = rows.filter((r) => filters.every((f) => f(r)));
        return { data: found[0] ?? null, error: null };
      },
      then(onFulfilled: (v: { data: Row[]; error: null }) => unknown, onRejected?: (e: unknown) => unknown) {
        const found = rows.filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data: found, error: null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  function insert(row: Row) {
    const newRow: Row = { id: nextId(), ...insertDefaults, ...row };
    return {
      select: () => ({
        single: async () => {
          if (rows.some((r) => r.account_id === newRow.account_id && r.phone === newRow.phone)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          rows.push(newRow);
          return { data: newRow, error: null };
        },
      }),
    };
  }

  function update(patch: Row) {
    const filters: Array<(r: Row) => boolean> = [];
    const builder = {
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      then(onFulfilled: (v: { data: null; error: null }) => unknown) {
        for (const r of rows.filter((row) => filters.every((f) => f(row)))) Object.assign(r, patch);
        return Promise.resolve({ data: null, error: null }).then(onFulfilled);
      },
    };
    return builder;
  }

  return { select, insert, update };
}

function makeDb(opts: { profiles?: Row[]; accounts?: Row[] } = {}) {
  let idCounter = 0;
  const nextId = () => `row-${++idCounter}`;

  const contacts: Row[] = [];
  const deals: Row[] = [];
  const profiles: Row[] = opts.profiles ?? [];
  const accounts: Row[] = opts.accounts ?? [{ id: 'acct-1', default_currency: 'BRL' }];

  const tables: Record<string, ReturnType<typeof makeTable>> = {
    contacts: makeTable(contacts, nextId),
    // `status` defaults to 'open' in the real schema (column default);
    // capture.ts's insert never sets it explicitly, relying on that.
    deals: makeTable(deals, nextId, { status: 'open' }),
    profiles: makeTable(profiles, nextId),
    accounts: makeTable(accounts, nextId),
  };

  return {
    from(table: string) {
      const t = tables[table];
      if (!t) throw new Error(`fake db: unexpected table '${table}'`);
      return t;
    },
    _rows: { contacts, deals },
  };
}

const SOURCE: LeadSourceConfig = {
  accountId: 'acct-1',
  pipelineId: 'pipe-1',
  stageId: 'stage-1',
  leadOriginId: null,
  createdBy: 'user-1',
};

describe('captureLead — dedup', () => {
  it('creates a new contact and deal on first capture', async () => {
    const db = makeDb();
    const result = await captureLead(db as never, SOURCE, { phone: '+55 11 99999-0001', name: 'Maria' });

    expect(result.status).toBe('ok');
    expect(result.contactOutcome).toBe('created');
    expect(result.dealOutcome).toBe('created');
    expect(db._rows.contacts).toHaveLength(1);
    expect(db._rows.deals).toHaveLength(1);
  });

  it('matches the existing contact on a repeat phone instead of duplicating it', async () => {
    const db = makeDb();
    const first = await captureLead(db as never, SOURCE, { phone: '+5511999990001', name: 'Maria' });
    const second = await captureLead(db as never, SOURCE, { phone: '5511999990001', email: 'maria@exemplo.com' });

    expect(second.status).toBe('ok');
    expect(second.contactOutcome).toBe('matched');
    expect(second.contactId).toBe(first.contactId);
    expect(db._rows.contacts).toHaveLength(1); // no duplicate row
  });

  it('does not open a second deal when the matched contact already has one open', async () => {
    const db = makeDb();
    await captureLead(db as never, SOURCE, { phone: '+5511999990002', name: 'João' });
    const second = await captureLead(db as never, SOURCE, { phone: '+5511999990002' });

    expect(second.dealOutcome).toBe('skipped_duplicate');
    expect(db._rows.deals).toHaveLength(1);
  });

  it('enriches the matched contact additively without overwriting existing fields', async () => {
    const db = makeDb();
    await captureLead(db as never, SOURCE, { phone: '+5511999990003', name: 'Carla' });
    await captureLead(db as never, SOURCE, { phone: '+5511999990003', name: 'Outro Nome', email: 'carla@exemplo.com' });

    const contact = db._rows.contacts[0];
    expect(contact.name).toBe('Carla'); // first value wins, second name ignored
    expect(contact.email).toBe('carla@exemplo.com'); // first was empty, second fills it
  });

  it('rejects a capture with no usable phone', async () => {
    const db = makeDb();
    const result = await captureLead(db as never, SOURCE, { phone: '' });

    expect(result.status).toBe('error');
    expect(db._rows.contacts).toHaveLength(0);
  });

  it('errors when no owner can be resolved for the account', async () => {
    const db = makeDb({ profiles: [] });
    const sourceWithoutCreator: LeadSourceConfig = { ...SOURCE, createdBy: null };
    const result = await captureLead(db as never, sourceWithoutCreator, { phone: '+5511999990004' });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toMatch(/responsável/);
  });
});
