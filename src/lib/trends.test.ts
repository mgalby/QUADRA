import { describe, expect, it } from 'vitest';
import { slicesInMonth } from './basis';
import { summarizeSlices } from './stats';
import { buildStats, closedAverage, discFocus } from './trends';
import type { Category, Transaction } from './types';

const cat = (id: string, flag: Category['flag']): [string, Category] => [
  id,
  { id, macro_id: 'M', flag, name: id, icon: 'x', shade: null, pinned_slot: null, sort_order: 0, archived: false, user_id: 'u', updated_at: '', client_modified_at: '', deleted_at: null },
];
const cats = new Map([
  cat('spesa', 'essential'), cat('bollette', 'essential'), cat('bar', 'discretionary'), cat('tech', 'discretionary'),
  cat('cene', 'discretionary'), cat('musica', 'discretionary'), cat('libri', 'discretionary'), cat('stipendio', 'essential'),
]);

let n = 0;
const tx = (kind: Transaction['tx_kind'], category_id: string, amount: number, date: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, tx_kind: kind, total: amount, tx_date: date, merchant_id: null, note: null, status: 'confirmed',
  accrual_mode: 'same', fx_status: 'none', recurrence_id: null, occurrence_date: null, installment_id: null, client_modified_at: '', deleted_at: null,
  lines: [{ category_id, amount, flag_override: null }], ...extra,
});

const TODAY = '2026-11-16';

describe('andamento mensile', () => {
  const txs = [
    tx('expense', 'spesa', 100, '2026-08-05'),
    tx('expense', 'bar', 30, '2026-08-06'),
    tx('expense', 'bar', 60, '2026-09-10'),
    tx('expense', 'bar', 90, '2026-10-10'),
    tx('expense', 'spesa', 200, '2026-10-11'),
    tx('income', 'stipendio', 3000, '2026-10-27'),
    tx('expense', 'bar', 45, '2026-11-03'),
    tx('expense', 'spesa', 55, '2026-11-04'),
    tx('expense', 'bar', 500, '2026-11-28'),                                   // futura: fuori
    tx('expense', 'bar', 70, '2026-11-10', { status: 'scheduled' }),           // da confermare: fuori
    tx('expense', 'bar', 999, '2026-11-02', { deleted_at: '2026-11-03' }),     // cancellata: fuori
  ];
  const s = buildStats(txs, cats, 'accrual', TODAY, 3);

  it('un punto per mese, l\'ultimo è il mese in corso', () => {
    expect(s.months.map((p) => p.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(s.months.map((p) => p.partial)).toEqual([false, false, true]);
    expect(s.history.map((p) => p.month)).toEqual(['2026-06', '2026-07', '2026-08']);
  });
  it('separa essenziali, discrezionali ed entrate', () => {
    expect(s.months[1]).toMatchObject({ essential: 20000, discretionary: 9000, expense: 29000, income: 300000 });
  });
  it('conta solo ciò che è avvenuto', () => {
    expect(s.months[2]).toMatchObject({ essential: 5500, discretionary: 4500, expense: 10000 });
  });
  it('coincide con la Home, tolti i programmati', () => {
    const home = summarizeSlices(slicesInMonth(txs, 'accrual', '2026-11', TODAY).filter((x) => !x.scheduled), cats);
    expect(s.months[2].expense).toBe(home.expense);
    expect(s.months[2].discretionary).toBe(home.discretionary);
  });
  it('discrezionali contro la media dei tre mesi precedenti', () => {
    const f = discFocus(s, '2026-11')!;
    expect(f.discretionary).toBe(4500);
    expect(f.share).toBeCloseTo(0.45);
    expect(f.average).toBe(6000); // 30, 60, 90
    expect(f.delta).toBeCloseTo(-0.25);
    expect(f.basedOn).toBe(3);
  });
  it('la media usa solo i mesi dal primo dato in poi', () => {
    const f = discFocus(s, '2026-09')!;
    expect(f.basedOn).toBe(1);           // solo agosto: giugno e luglio sono prima del primo movimento
    expect(f.average).toBe(3000);
    expect(f.delta).toBeCloseTo(1);
    expect(discFocus(s, '2026-08')!.average).toBeNull();
    expect(discFocus(s, '2026-08')!.delta).toBeNull();
  });
  it('media sui mesi chiusi del periodo', () => {
    expect(closedAverage(s, (p) => p.discretionary)).toBe(7500);
    const solo = buildStats([tx('expense', 'bar', 10, '2026-11-02')], cats, 'accrual', TODAY, 3);
    expect(closedAverage(solo, (p) => p.discretionary)).toBeNull();
  });
});

describe('flag riga per riga', () => {
  const split = tx('expense', 'spesa', 100, '2026-11-05', {
    merchant_id: 'coop',
    lines: [{ category_id: 'spesa', amount: 70, flag_override: null }, { category_id: 'tech', amount: 30, flag_override: null }],
  });
  const forced = tx('expense', 'spesa', 20, '2026-11-06', { merchant_id: 'coop', lines: [{ category_id: 'spesa', amount: 20, flag_override: 'discretionary' }] });

  it('uno scontrino diviso conta come discrezionale solo per la sua quota', () => {
    const s = buildStats([split, forced], cats, 'accrual', TODAY, 3);
    expect(s.months[2]).toMatchObject({ essential: 7000, discretionary: 5000 });
  });
  it('solo discrezionali: categorie ed esercizi si filtrano, l\'andamento no', () => {
    const s = buildStats([split, forced], cats, 'accrual', TODAY, 3, true);
    expect(s.shown).toBe(5000);
    expect(s.months[2].expense).toBe(12000);
    expect(s.categories.map((c) => [c.key, c.cents])).toEqual([['tech', 3000], ['spesa', 2000]]);
    expect(s.merchants).toEqual([{ key: 'coop', cents: 5000, count: 2, share: 1 }]);
  });
});

describe('categorie nel tempo ed esercizi', () => {
  const txs = [
    tx('expense', 'spesa', 300, '2026-09-05', { merchant_id: 'coop' }),
    tx('expense', 'spesa', 100, '2026-11-05', { merchant_id: 'coop-vecchia' }),
    tx('expense', 'bar', 50, '2026-10-05', { merchant_id: 'bar' }),
    tx('expense', 'tech', 40, '2026-10-06'),
    tx('expense', 'cene', 30, '2026-10-07'),
    tx('expense', 'bollette', 20, '2026-10-08'),
    tx('expense', 'musica', 6, '2026-10-09'),
    tx('expense', 'libri', 4, '2026-11-09'),
    tx('expense', 'spesa', 999, '2026-06-01'), // fuori dal periodo
    tx('income', 'stipendio', 3000, '2026-10-27', { merchant_id: 'azienda' }),
  ];
  const s = buildStats(txs, cats, 'accrual', TODAY, 3, false, new Map([['coop-vecchia', 'coop']]));

  it('le prime cinque più Altre, con i valori mese per mese', () => {
    expect(s.categories.map((c) => c.key)).toEqual(['spesa', 'bar', 'tech', 'cene', 'bollette', 'other']);
    expect(s.categories[0].byMonth).toEqual([30000, 0, 10000]);
    expect(s.categories[5]).toMatchObject({ cents: 1000, byMonth: [0, 600, 400] });
    expect(s.categories.reduce((a, c) => a + c.cents, 0)).toBe(s.shown);
    expect(s.categories.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1);
  });
  it('esercizi: uniti quelli fusi, senza esercizio a parte, entrate escluse', () => {
    expect(s.merchants[0]).toMatchObject({ key: 'coop', cents: 40000, count: 2 });
    expect(s.merchants.find((m) => m.key === '')).toMatchObject({ cents: 10000, count: 5 });
    expect(s.merchants.some((m) => m.key === 'azienda')).toBe(false);
  });
  it('periodo vuoto', () => {
    const e = buildStats([], cats, 'accrual', TODAY, 12);
    expect(e.months).toHaveLength(12);
    expect(e.shown).toBe(0);
    expect(e.categories).toEqual([]);
    expect(e.firstMonth).toBeNull();
    expect(discFocus(e, '2026-11')!.share).toBeNull();
  });
});

describe('cassa e competenza', () => {
  // assicurazione pagata a ottobre e spalmata su ottobre-dicembre
  const spread = tx('expense', 'bollette', 300, '2026-10-01', {
    merchant_id: 'unipol',
    accruals: [{ period: '2026-10-01', amount: 100 }, { period: '2026-11-01', amount: 100 }, { period: '2026-12-01', amount: 100 }],
  });
  it('competenza: una quota per mese, quella futura resta fuori', () => {
    const s = buildStats([spread], cats, 'accrual', TODAY, 3);
    expect(s.months.map((p) => p.expense)).toEqual([0, 10000, 10000]);
    expect(s.merchants[0]).toMatchObject({ cents: 20000, count: 1 });
  });
  it('cassa: tutto nel mese del pagamento', () => {
    const s = buildStats([spread], cats, 'cash', TODAY, 3);
    expect(s.months.map((p) => p.expense)).toEqual([0, 30000, 0]);
  });
});

describe('buildStats con mese in evidenza', () => {
  it('categorie ed esercizi seguono il mese; le barrette restano su tutto il periodo', () => {
    const txs = [
      tx('expense', 'bar', 10, '2026-10-05', { merchant_id: 'm1' }),
      tx('expense', 'spesa', 30, '2026-11-02', { merchant_id: 'm2' }),
    ];
    const all = buildStats(txs, cats, 'accrual', TODAY, 3);
    const nov = buildStats(txs, cats, 'accrual', TODAY, 3, false, new Map(), '2026-11');
    expect(all.categories.length).toBe(2);
    expect(nov.categories.map((c) => c.key)).toEqual(['spesa']);
    expect(nov.categories[0]).toMatchObject({ cents: 3000, share: 1 });
    expect(nov.merchants.map((m) => m.key)).toEqual(['m2']);
    expect(nov.shown).toBe(3000);
    expect(nov.months).toEqual(all.months);
  });
});
