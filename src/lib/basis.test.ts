import { describe, expect, it } from 'vitest';
import { accrualsOf, lineShares, paymentsOf, slicesInMonth, slicesOf } from './basis';
import { summarizeSlices } from './stats';
import type { Category, Transaction } from './types';

const base = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't', tx_kind: 'expense', total: 100, tx_date: '2026-11-10', merchant_id: null, note: null, status: 'confirmed',
  accrual_mode: 'same', fx_status: 'none', recurrence_id: null, occurrence_date: null, installment_id: null,
  client_modified_at: '', deleted_at: null, lines: [{ category_id: 'spesa', amount: 100, flag_override: null }], ...over,
});
const cat = (id: string, macro_id: string, flag: Category['flag']): [string, Category] => [
  id, { id, macro_id, flag, name: id, icon: 'x', shade: null, pinned_slot: null, sort_order: 0, archived: false, user_id: 'u', updated_at: '', client_modified_at: '', deleted_at: null },
];
const cats = new Map([cat('spesa', 'M1', 'essential'), cat('animali', 'M2', 'essential'), cat('viaggi', 'M3', 'discretionary')]);

describe('cassa e competenza: movimento normale', () => {
  it('senza pagamenti né quote vale il default: tutto alla data del movimento', () => {
    const tx = base();
    expect(slicesOf(tx, 'cash', '2026-11-15')).toMatchObject([{ cents: 10000, date: '2026-11-10', count: 1, scheduled: false }]);
    expect(slicesOf(tx, 'accrual', '2026-11-15')).toMatchObject([{ cents: 10000, date: '2026-11-10', count: 1, scheduled: false }]);
  });

  it('una data futura resta "programmato" in entrambe le viste', () => {
    const tx = base({ tx_date: '2026-11-28' });
    expect(slicesOf(tx, 'cash', '2026-11-15')[0].scheduled).toBe(true);
    expect(slicesOf(tx, 'accrual', '2026-11-15')[0].scheduled).toBe(true);
  });

  it('pagamenti che non sommano al totale si ignorano: vale il default', () => {
    const tx = base({ payments: [{ pay_date: '2026-11-10', amount: 60 }], accruals: [{ period: '2026-11-01', amount: 99 }] });
    expect(paymentsOf(tx)).toEqual([{ pay_date: '2026-11-10', amount: 100 }]);
    expect(accrualsOf(tx)).toEqual([{ period: '2026-11-01', amount: 100 }]);
  });
});

describe('acconto e saldo: viaggio da 1.000 €', () => {
  const trip = base({
    total: 1000, tx_date: '2026-03-02',
    lines: [{ category_id: 'viaggi', amount: 1000, flag_override: null }],
    payments: [{ pay_date: '2026-06-15', amount: 700 }, { pay_date: '2026-03-02', amount: 300 }],
    accruals: [{ period: '2026-07-01', amount: 1000 }],
    accrual_mode: 'date',
  });
  const today = '2026-11-15';

  it('in Cassa: una voce a marzo (300) e una a giugno (700), nessuna a luglio', () => {
    expect(slicesInMonth([trip], 'cash', '2026-03', today).map((s) => s.cents)).toEqual([30000]);
    expect(slicesInMonth([trip], 'cash', '2026-06', today).map((s) => s.cents)).toEqual([70000]);
    expect(slicesInMonth([trip], 'cash', '2026-07', today)).toEqual([]);
  });

  it('in Competenza: tutto a luglio, niente a marzo e giugno', () => {
    expect(slicesInMonth([trip], 'accrual', '2026-07', today).map((s) => s.cents)).toEqual([100000]);
    expect(slicesInMonth([trip], 'accrual', '2026-03', today)).toEqual([]);
    expect(slicesInMonth([trip], 'accrual', '2026-06', today)).toEqual([]);
  });

  it('le fette hanno numero d\'ordine e totale', () => {
    const s = slicesOf(trip, 'cash', today);
    expect(s.map((x) => [x.seq, x.count])).toEqual([[1, 2], [2, 2]]);
  });

  it('pagamenti futuri sono programmati', () => {
    const s = slicesOf(trip, 'cash', '2026-04-01');
    expect(s.map((x) => x.scheduled)).toEqual([false, true]);
  });
});

describe('spalmatura: assicurazione da 600 € pagata a gennaio', () => {
  const quote = Array.from({ length: 12 }, (_, i) => ({ period: `2026-${String(i + 1).padStart(2, '0')}-01`, amount: 50 }));
  const ins = base({ total: 600, tx_date: '2026-01-05', accruals: quote, accrual_mode: 'spread', lines: [{ category_id: 'spesa', amount: 600, flag_override: null }] });

  it('in Cassa 600 € a gennaio; in Competenza 50 € ogni mese', () => {
    expect(slicesInMonth([ins], 'cash', '2026-01', '2026-11-15').map((s) => s.cents)).toEqual([60000]);
    expect(slicesInMonth([ins], 'cash', '2026-02', '2026-11-15')).toEqual([]);
    expect(slicesInMonth([ins], 'accrual', '2026-02', '2026-11-15').map((s) => s.cents)).toEqual([5000]);
    expect(slicesInMonth([ins], 'accrual', '2026-12', '2026-11-15').map((s) => s.cents)).toEqual([5000]);
  });

  it('la quota del mese del movimento ha la data del movimento, le altre il primo del mese', () => {
    const s = slicesOf(ins, 'accrual', '2026-11-15');
    expect(s[0].date).toBe('2026-01-05');
    expect(s[1].date).toBe('2026-02-01');
  });

  it('le quote future sono programmate', () => {
    const s = slicesOf(ins, 'accrual', '2026-11-15');
    expect(s[10].scheduled).toBe(false); // novembre: il primo del mese è già passato
    expect(s[11].scheduled).toBe(true);  // dicembre
  });

  it('totale di tutti i mesi = totale del movimento', () => {
    const all = slicesOf(ins, 'accrual', '2026-11-15').reduce((a, s) => a + s.cents, 0);
    expect(all).toBe(60000);
  });
});

describe('ripartizione sulle righe (scontrino diviso)', () => {
  const split = base({
    total: 100,
    lines: [{ category_id: 'spesa', amount: 80, flag_override: null }, { category_id: 'animali', amount: 20, flag_override: null }],
  });

  it('una fetta intera si ripartisce come le righe', () => {
    expect(lineShares(split, 10000).map((l) => l.cents)).toEqual([8000, 2000]);
  });

  it('una fetta parziale si ripartisce in proporzione, e somma sempre alla fetta', () => {
    const parts = lineShares(split, 3333);
    expect(parts.map((l) => l.cents)).toEqual([2666, 667]);
    expect(parts.reduce((a, l) => a + l.cents, 0)).toBe(3333);
  });

  it('il riepilogo del mese somma alla fetta anche con arrotondamenti', () => {
    const quote = [{ period: '2026-11-01', amount: 33.33 }, { period: '2026-12-01', amount: 33.33 }, { period: '2027-01-01', amount: 33.34 }];
    const tx = { ...split, accruals: quote, accrual_mode: 'spread' as const };
    let grand = 0;
    for (const m of ['2026-11', '2026-12', '2027-01']) {
      const s = summarizeSlices(slicesInMonth([tx], 'accrual', m, '2026-11-15'), cats);
      grand += s.expense;
    }
    expect(grand).toBe(10000);
  });
});

describe('il totale di un mese coincide con Home in entrambe le viste', () => {
  it('Cassa e Competenza dello stesso mese: la somma dei movimenti normali è identica', () => {
    const txs = [base({ id: 'a', total: 10, tx_date: '2026-11-03', lines: [{ category_id: 'spesa', amount: 10, flag_override: null }] }),
      base({ id: 'b', total: 5.5, tx_date: '2026-11-20', lines: [{ category_id: 'animali', amount: 5.5, flag_override: null }] })];
    const cash = summarizeSlices(slicesInMonth(txs, 'cash', '2026-11', '2026-11-15'), cats);
    const acc = summarizeSlices(slicesInMonth(txs, 'accrual', '2026-11', '2026-11-15'), cats);
    expect(cash.expense).toBe(1550);
    expect(acc.expense).toBe(1550);
    expect(cash.scheduled).toBe(550);
  });
});
