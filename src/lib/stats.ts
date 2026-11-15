import { toCents } from './money';
import type { Category, Transaction } from './types';

export interface MacroTotal {
  macroId: string;
  cents: number;
  scheduledCents: number; // di cui programmati
}

export interface CategoryTotal {
  categoryId: string;
  macroId: string;
  cents: number;
  scheduledCents: number;
}

export interface MonthSummary {
  income: number;
  expense: number;        // tutte le uscite, per il saldo
  shown: number;          // uscite mostrate nella ciambella (tutte, o solo le discrezionali)
  scheduled: number;      // uscite programmate, dentro "shown"
  discretionary: number;
  byMacro: MacroTotal[];  // ordinate dalla più pesante
  byCategory: CategoryTotal[]; // raggruppate per macro (la più pesante prima), poi per importo
}

/** Programmato = confermato dal sistema come tale, oppure con data futura. */
export const isScheduled = (tx: Transaction, today: string): boolean =>
  tx.status === 'scheduled' || tx.tx_date > today;

export function summarize(
  txs: Transaction[],
  categories: Map<string, Category>,
  today: string,
  onlyDiscretionary = false,
): MonthSummary {
  const s: MonthSummary = { income: 0, expense: 0, shown: 0, scheduled: 0, discretionary: 0, byMacro: [], byCategory: [] };
  const cats = new Map<string, CategoryTotal>();
  const macros = new Map<string, MacroTotal>();

  for (const tx of txs) {
    if (tx.deleted_at) continue;
    const scheduled = isScheduled(tx, today);
    for (const line of tx.lines) {
      const cents = toCents(line.amount);
      if (tx.tx_kind === 'income') {
        s.income += cents;
        continue;
      }
      const cat = categories.get(line.category_id);
      const discretionary = (line.flag_override ?? cat?.flag) === 'discretionary';
      s.expense += cents;
      if (discretionary) s.discretionary += cents;
      if (onlyDiscretionary && !discretionary) continue;

      s.shown += cents;
      if (scheduled) s.scheduled += cents;
      const macroId = cat?.macro_id ?? '';
      const m = macros.get(macroId) ?? { macroId, cents: 0, scheduledCents: 0 };
      m.cents += cents;
      if (scheduled) m.scheduledCents += cents;
      macros.set(macroId, m);
      const c = cats.get(line.category_id) ?? { categoryId: line.category_id, macroId, cents: 0, scheduledCents: 0 };
      c.cents += cents;
      if (scheduled) c.scheduledCents += cents;
      cats.set(line.category_id, c);
    }
  }
  s.byMacro = [...macros.values()].sort((a, b) => b.cents - a.cents);
  const macroRank = new Map(s.byMacro.map((m, i) => [m.macroId, i]));
  s.byCategory = [...cats.values()].sort((a, b) => macroRank.get(a.macroId)! - macroRank.get(b.macroId)! || b.cents - a.cents);
  return s;
}

export interface Slice {
  key: string;        // id della macro o della categoria, oppure "other"
  cents: number;
  scheduledCents: number;
  share: number;      // 0..1
}

/** Spicchi della ciambella: quelli sotto la soglia finiscono in "Altro". */
export function donutSlices(byMacro: MacroTotal[], total: number, threshold = 0.03): Slice[] {
  if (total <= 0) return [];
  const slices: Slice[] = [];
  const other: Slice = { key: 'other', cents: 0, scheduledCents: 0, share: 0 };
  for (const m of byMacro) {
    if (m.cents / total < threshold) {
      other.cents += m.cents;
      other.scheduledCents += m.scheduledCents;
    } else {
      slices.push({ key: m.macroId, cents: m.cents, scheduledCents: m.scheduledCents, share: m.cents / total });
    }
  }
  if (other.cents > 0) slices.push({ ...other, share: other.cents / total });
  return slices;
}

/** Come donutSlices, ma per categoria: gli spicchi restano raggruppati per macro. */
export function donutSlicesByCategory(byCategory: CategoryTotal[], total: number, threshold = 0.03): Slice[] {
  if (total <= 0) return [];
  const slices: Slice[] = [];
  const other: Slice = { key: 'other', cents: 0, scheduledCents: 0, share: 0 };
  for (const c of byCategory) {
    if (c.cents / total < threshold) {
      other.cents += c.cents;
      other.scheduledCents += c.scheduledCents;
    } else {
      slices.push({ key: c.categoryId, cents: c.cents, scheduledCents: c.scheduledCents, share: c.cents / total });
    }
  }
  if (other.cents > 0) slices.push({ ...other, share: other.cents / total });
  return slices;
}
