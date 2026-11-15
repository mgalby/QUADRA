import { describe, expect, it } from 'vitest';
import { donutSlices, donutSlicesByCategory, summarize } from './stats';
import type { Category, Transaction } from './types';

const cat = (id: string, macro_id: string, flag: Category['flag']): [string, Category] => [
  id,
  { id, macro_id, flag, name: id, icon: 'x', shade: null, pinned_slot: null, sort_order: 0, archived: false, user_id: 'u', updated_at: '', client_modified_at: '', deleted_at: null },
];
const cats = new Map([cat('spesa', 'M1', 'essential'), cat('bar', 'M2', 'discretionary'), cat('stipendio', 'M9', 'essential')]);

const tx = (kind: Transaction['tx_kind'], category_id: string, amount: number, date = '2026-11-10', extra: Partial<Transaction> = {}): Transaction => ({
  id: Math.random().toString(), tx_kind: kind, total: amount, tx_date: date, merchant_id: null, note: null, status: 'confirmed',
  accrual_mode: 'same', fx_status: 'none', recurrence_id: null, occurrence_date: null, installment_id: null, client_modified_at: '', deleted_at: null,
  lines: [{ category_id, amount, flag_override: null }], ...extra,
});

describe('riepilogo del mese', () => {
  const txs = [
    tx('expense', 'spesa', 24.5),
    tx('expense', 'spesa', 0.1),
    tx('expense', 'spesa', 0.2),
    tx('expense', 'bar', 5),
    tx('expense', 'bar', 85, '2026-11-28'), // futura: programmata
    tx('income', 'stipendio', 3050),
    tx('expense', 'bar', 999, '2026-11-01', { deleted_at: '2026-11-02' }),
  ];
  const s = summarize(txs, cats, '2026-11-14');

  it('somma in centesimi senza errori di virgola', () => {
    expect(s.expense).toBe(2450 + 10 + 20 + 500 + 8500);
    expect(s.income).toBe(305000);
  });
  it('separa discrezionali e programmati, ignora i cancellati', () => {
    expect(s.discretionary).toBe(9000);
    expect(s.scheduled).toBe(8500);
    expect(s.byMacro).toEqual([
      { macroId: 'M2', cents: 9000, scheduledCents: 8500 },
      { macroId: 'M1', cents: 2480, scheduledCents: 0 },
    ]);
  });
  it('filtro solo discrezionali: cambia la ciambella, non il saldo', () => {
    const d = summarize(txs, cats, '2026-11-14', true);
    expect(d.shown).toBe(9000);
    expect(d.expense).toBe(s.expense);
    expect(d.byMacro.map((m) => m.macroId)).toEqual(['M2']);
  });
  it('override del flag sul singolo movimento', () => {
    const o = summarize([tx('expense', 'spesa', 10, '2026-11-10', { lines: [{ category_id: 'spesa', amount: 10, flag_override: 'discretionary' }] })], cats, '2026-11-14');
    expect(o.discretionary).toBe(1000);
  });
});

describe('spicchi della ciambella', () => {
  it('raggruppa in Altro quelli sotto il 3%', () => {
    const slices = donutSlices(
      [{ macroId: 'A', cents: 9000, scheduledCents: 0 }, { macroId: 'B', cents: 800, scheduledCents: 0 }, { macroId: 'C', cents: 150, scheduledCents: 50 }, { macroId: 'D', cents: 50, scheduledCents: 0 }],
      10000,
    );
    expect(slices.map((x) => [x.key, x.cents])).toEqual([['A', 9000], ['B', 800], ['other', 200]]);
    expect(slices[2].scheduledCents).toBe(50);
    expect(slices.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1);
  });
  it('mese vuoto', () => expect(donutSlices([], 0)).toEqual([]));
});

describe('per categoria', () => {
  const t = [tx('expense', 'spesa', 60), tx('expense', 'bar', 30), tx('expense', 'bar', 9), tx('expense', 'spesa', 1)];
  it('raggruppa per macro (la più pesante prima) e ordina per importo', () => {
    const s = summarize(t, cats, '2026-11-14');
    expect(s.byCategory.map((c) => [c.categoryId, c.cents])).toEqual([['spesa', 6100], ['bar', 3900]]);
  });
  it('gli spicchi sotto il 3% finiscono in Altro', () => {
    const s = summarize(t, cats, '2026-11-14');
    expect(donutSlicesByCategory(s.byCategory, s.shown).map((x) => x.key)).toEqual(['spesa', 'bar']);
    expect(donutSlicesByCategory([{ categoryId: 'a', macroId: 'M', cents: 9900, scheduledCents: 0 }, { categoryId: 'b', macroId: 'M', cents: 100, scheduledCents: 0 }], 10000).map((x) => x.key)).toEqual(['a', 'other']);
  });
});
