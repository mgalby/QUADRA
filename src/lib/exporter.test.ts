import { describe, expect, it } from 'vitest';
import { parseCsv, readTable } from './csv';
import { buildExport, EXPORT_HEADER } from './exporter';
import type { Transaction } from './types';

let n = 0;
const tx = (kind: Transaction['tx_kind'], category_id: string, amount: number, date: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, tx_kind: kind, total: amount, tx_date: date, merchant_id: null, note: null, status: 'confirmed',
  accrual_mode: 'same', fx_status: 'none', recurrence_id: null, occurrence_date: null, installment_id: null, client_modified_at: '', deleted_at: null,
  lines: [{ category_id, amount, flag_override: null }], ...extra,
});
const catName = (id: string) => ({ spesa: 'Spesa alimentare', tech: 'Tech', stip: 'Stipendio', ass: 'Assicurazioni' })[id] ?? '';
const merName = (id: string) => ({ coop: 'Coop', anth: 'Anthropic; PBC' })[id] ?? '';

const txs = [
  tx('expense', 'spesa', 45.2, '2026-11-16', { merchant_id: 'coop', note: 'Spesa settimanale' }),
  tx('income', 'stip', 1500, '2026-11-27'),
  tx('expense', 'spesa', 1234.5, '2026-10-02', {
    merchant_id: 'coop',
    lines: [{ category_id: 'spesa', amount: 1000, flag_override: null }, { category_id: 'tech', amount: 234.5, flag_override: null }],
  }),
  tx('expense', 'ass', 300, '2026-10-01', {
    accruals: [{ period: '2026-10-01', amount: 100 }, { period: '2026-11-01', amount: 100 }, { period: '2026-12-01', amount: 100 }],
  }),
  tx('expense', 'spesa', 200, '2026-11-10', { accruals: [{ period: '2027-02-01', amount: 200 }] }),
  tx('expense', 'tech', 18.71, '2026-11-05', { merchant_id: 'anth', note: '=abbonamento', currency: 'USD', amount_original: 20, fx_rate: 1.068947, fx_status: 'final' }),
  tx('expense', 'spesa', 9, '2026-11-11', { deleted_at: '2026-11-12' }),
  tx('expense', 'spesa', 9, '2026-11-12', { status: 'scheduled' }),
  tx('expense', 'spesa', 9, '2026-09-30'),
];

describe('esportazione CSV', () => {
  const r = buildExport(txs, '2026-10-01', '2026-11-30', catName, merName, 'EUR');
  const table = parseCsv(r.text.replace(/^﻿/, ''));

  it('intestazione del tracciato di import, BOM e separatore ;', () => {
    expect(r.text.startsWith('﻿')).toBe(true);
    expect(table[0]).toEqual(EXPORT_HEADER);
  });
  it('solo i movimenti confermati nell\'intervallo, dal più vecchio', () => {
    expect(r.movements).toBe(6);
    expect(table.slice(1).map((c) => c[0])).toEqual(['01/10/2026', '02/10/2026', '02/10/2026', '05/11/2026', '10/11/2026', '16/11/2026', '27/11/2026']);
  });
  it('scontrino diviso: una riga per categoria', () => {
    expect(r.split).toBe(1);
    expect(table.slice(2, 4).map((c) => [c[1], c[3], c[4]])).toEqual([['1000,00', 'Spesa alimentare', 'Coop'], ['234,50', 'Tech', 'Coop']]);
  });
  it('competenza: solo se diversa dal mese del pagamento; del piano resta il primo mese', () => {
    expect(r.lostPlans).toBe(1);
    expect(table[1][6]).toBe('');
    expect(table[5][6]).toBe('2027-02');
  });
  it('valuta estera e celle protette', () => {
    expect(table[4].slice(4)).toEqual(['Anthropic; PBC', "'=abbonamento", '', 'USD', '20,00']);
  });
  it('si rilegge con l\'import senza errori', () => {
    const back = readTable(table);
    expect(back.problem).toBeNull();
    expect(back.rows.every((x) => x.error === null)).toBe(true);
    expect(back.rows.map((x) => [x.date, x.signed, x.sign])).toContainEqual(['2026-11-16', 4520, 'expense']);
    expect(back.rows.map((x) => [x.date, x.signed, x.sign])).toContainEqual(['2026-11-27', 150000, 'income']);
    expect(back.rows[4]).toMatchObject({ month: '2027-02', category: 'Spesa alimentare' });
    expect(back.rows[3]).toMatchObject({ currency: 'USD', original: 2000 });
  });
  it('intervallo vuoto: solo l\'intestazione', () => {
    const e = buildExport(txs, '2025-01-01', '2025-12-31', catName, merName, 'EUR');
    expect(e.rows).toBe(0);
    expect(parseCsv(e.text.replace(/^﻿/, ''))).toHaveLength(1);
  });
});
