// Più opzioni dell'inserimento: spalmare la competenza su più mesi e dividere il
// pagamento in acconto e saldo. Logica pura, senza schermo né database.
import { accrualsOf, monthStart, paymentsOf } from './basis';
import { addMonths } from './dates';
import { fromCents, toCents } from './money';
import { splitInstallments } from './recurrence';
import type { Transaction } from './types';

export interface AccRow {
  month: string; // AAAA-MM
  cents: number;
}
export interface PayRow {
  date: string;  // AAAA-MM-GG
  cents: number;
}
/** null = comportamento di default (una quota nel mese del movimento, un pagamento alla sua data). */
export interface Plan {
  acc: AccRow[] | null;
  pay: PayRow[] | null;
}

export const emptyPlan: Plan = { acc: null, pay: null };
export const isCustom = (plan: Plan): boolean => plan.acc !== null || plan.pay !== null;
export const sum = (rows: { cents: number }[]): number => rows.reduce((s, r) => s + r.cents, 0);

/** Quote uguali su N mesi a partire da un mese; l'ultima assorbe i centesimi. */
export function spreadRows(totalCents: number, startMonth: string, n: number): AccRow[] {
  return splitInstallments(totalCents, n).map((cents, i) => ({ month: addMonths(startMonth, i), cents }));
}

/** Ridistribuisce un nuovo totale in proporzione alle parti esistenti; l'ultima parte assorbe i centesimi. */
export function rescaleCents(parts: number[], newTotal: number): number[] {
  const old = parts.reduce((a, b) => a + b, 0);
  if (parts.length === 0) return [];
  if (old === 0) return splitInstallments(newTotal, parts.length);
  let used = 0;
  return parts.map((c, i) => {
    const v = i === parts.length - 1 ? newTotal - used : Math.round((c * newTotal) / old);
    used += v;
    return v;
  });
}

/** Il piano personalizzato non somma più al totale (il totale è cambiato dopo averlo impostato). */
export const planMismatch = (plan: Plan, totalCents: number): boolean =>
  (plan.acc !== null && sum(plan.acc) !== totalCents) || (plan.pay !== null && sum(plan.pay) !== totalCents);

/** Ricalcola in proporzione le parti che non sommano al nuovo totale. */
export function rescalePlan(plan: Plan, totalCents: number): Plan {
  const fix = <T extends { cents: number }>(rows: T[] | null): T[] | null => {
    if (rows === null || sum(rows) === totalCents) return rows;
    const cents = rescaleCents(rows.map((r) => r.cents), totalCents);
    return rows.map((r, i) => ({ ...r, cents: cents[i] }));
  };
  return { acc: fix(plan.acc), pay: fix(plan.pay) };
}

/** Il piano di un movimento esistente: null dove vale il default. */
export function planFromTx(tx: Transaction): Plan {
  const pays = paymentsOf(tx);
  const accs = accrualsOf(tx);
  const payDefault = pays.length === 1 && pays[0].pay_date === tx.tx_date;
  const accDefault = accs.length === 1 && accs[0].period === monthStart(tx.tx_date);
  return {
    pay: payDefault ? null : pays.map((p) => ({ date: p.pay_date, cents: toCents(p.amount) })),
    acc: accDefault ? null : accs.map((a) => ({ month: a.period.slice(0, 7), cents: toCents(a.amount) })),
  };
}

/** Pagamenti e quote da salvare sul movimento (sempre completi). */
export function planToTx(plan: Plan, totalCents: number, txDate: string): {
  payments: { pay_date: string; amount: number }[];
  accruals: { period: string; amount: number }[];
  accrual_mode: 'same' | 'date' | 'spread';
} {
  const payments = plan.pay
    ? [...plan.pay].sort((a, b) => a.date.localeCompare(b.date)).map((p) => ({ pay_date: p.date, amount: fromCents(p.cents) }))
    : [{ pay_date: txDate, amount: fromCents(totalCents) }];
  const accruals = plan.acc
    ? [...plan.acc].sort((a, b) => a.month.localeCompare(b.month)).map((a) => ({ period: `${a.month}-01`, amount: fromCents(a.cents) }))
    : [{ period: monthStart(txDate), amount: fromCents(totalCents) }];
  const accrual_mode = plan.acc === null ? 'same' : plan.acc.length === 1 ? 'date' : 'spread';
  return { payments, accruals, accrual_mode };
}
