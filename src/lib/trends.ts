// Statistiche: andamento mese per mese, categorie nel tempo ed esercizi principali.
// Logica pura. Si appoggia alle stesse fette (pagamenti o quote) di Home e Movimenti,
// così i numeri di un mese coincidono sempre con quelli della Home.
import { lineShares, slicesOf, type Basis } from './basis';
import { addMonths, monthOf } from './dates';
import type { Category, Transaction } from './types';

export interface MonthPoint {
  month: string;         // AAAA-MM
  income: number;
  essential: number;
  discretionary: number;
  expense: number;       // essenziali + discrezionali
  partial: boolean;      // mese in corso
}

export interface CategoryTrend {
  key: string;           // id della categoria, oppure "other"
  cents: number;         // totale nel periodo
  share: number;         // 0..1 sul totale mostrato
  byMonth: number[];     // un valore per ogni mese del periodo
}

export interface MerchantTotal {
  key: string;           // id dell'esercizio, '' = senza esercizio
  cents: number;
  count: number;         // movimenti
  share: number;
}

export interface Stats {
  months: MonthPoint[];        // il periodo scelto, dal più vecchio; l'ultimo è il mese in corso
  history: MonthPoint[];       // i tre mesi prima del periodo, per i confronti
  firstMonth: string | null;   // mese del primo dato: prima di lì non c'è storia da confrontare
  shown: number;               // uscite del periodo (tutte, o solo le discrezionali)
  categories: CategoryTrend[];
  merchants: MerchantTotal[];
}

export const TOP_CATEGORIES = 5;
export const TOP_MERCHANTS = 10;
const LOOKBACK = 3;

/**
 * Statistiche del periodo di `n` mesi che termina con il mese di `today`.
 * Conta solo ciò che è già avvenuto: scadenze future e movimenti da confermare restano fuori.
 */
export function buildStats(
  txs: Transaction[],
  categories: Map<string, Category>,
  basis: Basis,
  today: string,
  n: number,
  onlyDiscretionary = false,
  mergedInto: Map<string, string> = new Map(),
): Stats {
  const last = monthOf(today);
  const all = Array.from({ length: n + LOOKBACK }, (_, i) => addMonths(last, i - (n + LOOKBACK - 1)));
  const index = new Map(all.map((m, i) => [m, i]));
  const points: MonthPoint[] = all.map((month) => ({ month, income: 0, essential: 0, discretionary: 0, expense: 0, partial: month === last }));
  const first = LOOKBACK; // primo indice del periodo mostrato

  const cats = new Map<string, { cents: number; byMonth: number[] }>();
  const merchants = new Map<string, { cents: number; ids: Set<string> }>();
  let shown = 0;
  let firstMonth: string | null = null;

  for (const tx of txs) {
    if (tx.deleted_at) continue;
    for (const slice of slicesOf(tx, basis, today)) {
      if (slice.scheduled) continue;
      const month = monthOf(slice.date);
      if (firstMonth === null || month < firstMonth) firstMonth = month;
      const i = index.get(month);
      if (i === undefined) continue;
      const p = points[i];
      for (const { line, cents } of lineShares(tx, slice.cents)) {
        if (tx.tx_kind === 'income') { p.income += cents; continue; }
        const disc = (line.flag_override ?? categories.get(line.category_id)?.flag) === 'discretionary';
        p.expense += cents;
        if (disc) p.discretionary += cents; else p.essential += cents;
        if (i < first || (onlyDiscretionary && !disc)) continue;

        shown += cents;
        const c = cats.get(line.category_id) ?? { cents: 0, byMonth: new Array<number>(n).fill(0) };
        c.cents += cents;
        c.byMonth[i - first] += cents;
        cats.set(line.category_id, c);
        const mid = tx.merchant_id ? mergedInto.get(tx.merchant_id) ?? tx.merchant_id : '';
        const m = merchants.get(mid) ?? { cents: 0, ids: new Set<string>() };
        m.cents += cents;
        m.ids.add(tx.id);
        merchants.set(mid, m);
      }
    }
  }

  const share = (cents: number) => (shown > 0 ? cents / shown : 0);
  const ranked = [...cats.entries()].filter(([, c]) => c.cents > 0).sort((a, b) => b[1].cents - a[1].cents || a[0].localeCompare(b[0]));
  const top: CategoryTrend[] = ranked.slice(0, TOP_CATEGORIES).map(([key, c]) => ({ key, cents: c.cents, share: share(c.cents), byMonth: c.byMonth }));
  const rest = ranked.slice(TOP_CATEGORIES);
  if (rest.length > 0) {
    const byMonth = new Array<number>(n).fill(0);
    let cents = 0;
    for (const [, c] of rest) {
      cents += c.cents;
      c.byMonth.forEach((v, i) => { byMonth[i] += v; });
    }
    top.push({ key: 'other', cents, share: share(cents), byMonth });
  }

  return {
    months: points.slice(first),
    history: points.slice(0, first),
    firstMonth,
    shown,
    categories: top,
    merchants: [...merchants.entries()]
      .filter(([, m]) => m.cents > 0)
      .map(([key, m]) => ({ key, cents: m.cents, count: m.ids.size, share: share(m.cents) }))
      .sort((a, b) => b.cents - a.cents || a.key.localeCompare(b.key))
      .slice(0, TOP_MERCHANTS),
  };
}

export interface DiscFocus {
  month: string;
  discretionary: number;
  expense: number;
  share: number | null;    // quota delle discrezionali sulle uscite del mese
  average: number | null;  // media delle discrezionali nei mesi chiusi precedenti (fino a tre)
  delta: number | null;    // scostamento dalla media, es. 0.18 = +18%
  basedOn: number;         // quanti mesi sono entrati nella media
}

/**
 * Le discrezionali di un mese a confronto con la media dei tre mesi precedenti.
 * Entrano nella media solo i mesi dal primo dato in poi: senza storia non c'è confronto.
 */
export function discFocus(stats: Stats, month: string): DiscFocus | null {
  const all = [...stats.history, ...stats.months];
  const i = all.findIndex((p) => p.month === month);
  if (i < 0) return null;
  const p = all[i];
  const prev = all.slice(Math.max(0, i - LOOKBACK), i).filter((x) => stats.firstMonth !== null && x.month >= stats.firstMonth);
  const average = prev.length > 0 ? Math.round(prev.reduce((s, x) => s + x.discretionary, 0) / prev.length) : null;
  return {
    month,
    discretionary: p.discretionary,
    expense: p.expense,
    share: p.expense > 0 ? p.discretionary / p.expense : null,
    average,
    delta: average !== null && average > 0 ? (p.discretionary - average) / average : null,
    basedOn: prev.length,
  };
}

/** Media mensile sui mesi chiusi del periodo (dal primo dato in poi); null se non ce ne sono. */
export function closedAverage(stats: Stats, pick: (p: MonthPoint) => number): number | null {
  const closed = stats.months.filter((p) => !p.partial && stats.firstMonth !== null && p.month >= stats.firstMonth);
  if (closed.length === 0) return null;
  return Math.round(closed.reduce((s, p) => s + pick(p), 0) / closed.length);
}
