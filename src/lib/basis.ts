// Cassa e competenza: ogni movimento si "affetta" in pezzi, uno per pagamento (cassa)
// oppure uno per quota di competenza, ciascuno nel suo mese. Home, statistiche ed
// elenco dei movimenti lavorano su queste fette, così i totali coincidono sempre.
import { toCents } from './money';
import type { Accrual, Payment, Transaction, TxLine } from './types';

export type Basis = 'accrual' | 'cash';

export const monthStart = (isoDate: string): string => `${isoDate.slice(0, 7)}-01`;

const sumCents = (items: { amount: number }[]): number => items.reduce((s, i) => s + toCents(i.amount), 0);

/** Pagamenti del movimento: quelli registrati se sommano al totale, altrimenti il default. */
export function paymentsOf(tx: Transaction): Payment[] {
  const p = tx.payments;
  if (p && p.length > 0 && sumCents(p) === toCents(tx.total)) {
    return [...p].sort((a, b) => a.pay_date.localeCompare(b.pay_date));
  }
  return [{ pay_date: tx.tx_date, amount: tx.total }];
}

/** Quote di competenza: quelle registrate se sommano al totale, altrimenti il default. */
export function accrualsOf(tx: Transaction): Accrual[] {
  const a = tx.accruals;
  if (a && a.length > 0 && sumCents(a) === toCents(tx.total)) {
    return [...a].sort((x, y) => x.period.localeCompare(y.period));
  }
  return [{ period: monthStart(tx.tx_date), amount: tx.total }];
}

/** Una fetta di movimento: la parte che cade in un pagamento o in una quota. */
export interface Slice {
  tx: Transaction;
  cents: number;
  date: string;      // AAAA-MM-GG: data del pagamento; per una quota il giorno del movimento se è nel suo mese, altrimenti il primo del mese
  seq: number;       // numero d'ordine, da 1
  count: number;     // quante fette ha il movimento in questa modalità
  scheduled: boolean;
}

export function slicesOf(tx: Transaction, basis: Basis, today: string): Slice[] {
  const pending = tx.status === 'scheduled';
  if (basis === 'cash') {
    const pays = paymentsOf(tx);
    return pays.map((p, i) => ({
      tx, cents: toCents(p.amount), date: p.pay_date, seq: i + 1, count: pays.length,
      scheduled: pending || p.pay_date > today,
    }));
  }
  const accs = accrualsOf(tx);
  const own = monthStart(tx.tx_date);
  return accs.map((a, i) => {
    const date = a.period === own ? tx.tx_date : a.period;
    return { tx, cents: toCents(a.amount), date, seq: i + 1, count: accs.length, scheduled: pending || date > today };
  });
}

/** Tutte le fette (movimenti non cancellati) che cadono in un mese AAAA-MM. */
export function slicesInMonth(txs: Transaction[], basis: Basis, month: string, today: string): Slice[] {
  const out: Slice[] = [];
  for (const tx of txs) {
    if (tx.deleted_at) continue;
    for (const s of slicesOf(tx, basis, today)) if (s.date.slice(0, 7) === month) out.push(s);
  }
  return out;
}

export interface LineShare {
  line: TxLine;
  cents: number;
}

/**
 * Quanto di una fetta spetta a ciascuna riga (categoria), in proporzione. L'ultima
 * riga prende il resto dei centesimi, così le parti sommano sempre alla fetta.
 */
export function lineShares(tx: Transaction, sliceCents: number): LineShare[] {
  const total = toCents(tx.total);
  const lines = tx.lines;
  if (lines.length === 0) return [];
  if (sliceCents === total) return lines.map((line) => ({ line, cents: toCents(line.amount) }));
  let used = 0;
  return lines.map((line, i) => {
    const cents = i === lines.length - 1 ? sliceCents - used : total === 0 ? 0 : Math.round((toCents(line.amount) * sliceCents) / total);
    used += cents;
    return { line, cents };
  });
}
