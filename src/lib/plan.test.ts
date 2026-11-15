import { describe, expect, it } from 'vitest';
import { planFromTx, planMismatch, planToTx, rescaleCents, rescalePlan, spreadRows } from './plan';
import type { Transaction } from './types';

describe('spalma', () => {
  it('600 € su 12 mesi da gennaio: 50 € al mese', () => {
    const rows = spreadRows(60000, '2026-01', 12);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ month: '2026-01', cents: 5000 });
    expect(rows[11]).toEqual({ month: '2026-12', cents: 5000 });
  });

  it('100 € su 3 mesi: l\'ultima quota assorbe i centesimi', () => {
    expect(spreadRows(10000, '2026-11', 3).map((r) => r.cents)).toEqual([3333, 3333, 3334]);
  });

  it('i mesi scavalcano l\'anno', () => {
    expect(spreadRows(30000, '2026-11', 3).map((r) => r.month)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('cambio del totale di un movimento con piano personalizzato', () => {
  it('ricalcola in proporzione, e somma sempre al nuovo totale', () => {
    expect(rescaleCents([3000, 7000], 20000)).toEqual([6000, 14000]);
    expect(rescaleCents([3333, 3333, 3334], 10001).reduce((a, b) => a + b, 0)).toBe(10001);
  });

  it('con parti tutte a zero divide in parti uguali', () => {
    expect(rescaleCents([0, 0], 1001)).toEqual([500, 501]);
  });

  it('riconosce un piano che non torna più e lo ripara', () => {
    const plan = { acc: [{ month: '2026-11', cents: 5000 }, { month: '2026-12', cents: 5000 }], pay: null };
    expect(planMismatch(plan, 12000)).toBe(true);
    const fixed = rescalePlan(plan, 12000);
    expect(planMismatch(fixed, 12000)).toBe(false);
    expect(fixed.acc!.map((r) => r.cents)).toEqual([6000, 6000]);
    expect(fixed.pay).toBeNull();
  });

  it('un piano di default non è mai "sbagliato"', () => {
    expect(planMismatch({ acc: null, pay: null }, 999)).toBe(false);
  });
});

describe('piano di un movimento esistente', () => {
  const tx = (over: Partial<Transaction>): Transaction => ({
    id: 't', tx_kind: 'expense', total: 100, tx_date: '2026-11-10', merchant_id: null, note: null, status: 'confirmed',
    accrual_mode: 'same', fx_status: 'none', recurrence_id: null, occurrence_date: null, installment_id: null,
    client_modified_at: '', deleted_at: null, lines: [], ...over,
  });

  it('un movimento normale non ha piano personalizzato', () => {
    expect(planFromTx(tx({}))).toEqual({ acc: null, pay: null });
    expect(planFromTx(tx({ payments: [{ pay_date: '2026-11-10', amount: 100 }], accruals: [{ period: '2026-11-01', amount: 100 }] }))).toEqual({ acc: null, pay: null });
  });

  it('pagamenti e quote diversi dal default si riconoscono', () => {
    const p = planFromTx(tx({
      payments: [{ pay_date: '2026-11-10', amount: 40 }, { pay_date: '2026-12-10', amount: 60 }],
      accruals: [{ period: '2027-01-01', amount: 100 }],
    }));
    expect(p.pay).toEqual([{ date: '2026-11-10', cents: 4000 }, { date: '2026-12-10', cents: 6000 }]);
    expect(p.acc).toEqual([{ month: '2027-01', cents: 10000 }]);
  });

  it('planToTx: il default produce un pagamento e una quota alla data del movimento', () => {
    expect(planToTx({ acc: null, pay: null }, 10000, '2026-11-10')).toEqual({
      payments: [{ pay_date: '2026-11-10', amount: 100 }],
      accruals: [{ period: '2026-11-01', amount: 100 }],
      accrual_mode: 'same',
    });
  });

  it('planToTx: una sola quota in un altro mese = "date", più quote = "spread"', () => {
    expect(planToTx({ acc: [{ month: '2027-01', cents: 10000 }], pay: null }, 10000, '2026-11-10').accrual_mode).toBe('date');
    expect(planToTx({ acc: [{ month: '2027-01', cents: 5000 }, { month: '2027-02', cents: 5000 }], pay: null }, 10000, '2026-11-10').accrual_mode).toBe('spread');
  });
});

describe('una sola quota in un altro mese (anticipo oggi, competenza a febbraio)', () => {
  it('si salva con modo "date" e il pagamento resta alla data del movimento', () => {
    const r = planToTx({ acc: [{ month: '2027-02', cents: 50000 }], pay: null }, 50000, '2026-11-15');
    expect(r.accrual_mode).toBe('date');
    expect(r.payments).toEqual([{ pay_date: '2026-11-15', amount: 500 }]);
    expect(r.accruals).toEqual([{ period: '2027-02-01', amount: 500 }]);
  });
  it('riaprendolo il piano torna uguale', () => {
    const base = { id: 'x', tx_date: '2026-11-15', total: 500, tx_kind: 'expense', lines: [], payments: [{ pay_date: '2026-11-15', amount: 500 }], accruals: [{ period: '2027-02-01', amount: 500 }] } as unknown as Transaction;
    expect(planFromTx(base)).toEqual({ acc: [{ month: '2027-02', cents: 50000 }], pay: null });
  });
});
