// Budget (v1.1): funzioni pure, senza archivio né rete. Decisioni in
// quadra/budget_v1_1.md (progetto Claude).
//
// - Budget di una riga = programmato (ricorrenze e piani rate dell'anno, calcolati)
//   + integrazione (l'unico numero scritto dall'utente).
// - Riga con categoria: essenziale = previsione, discrezionale = tetto dedicato,
//   entrata = budget dell'entrata. Riga con macro = tetto comune sulle categorie
//   discrezionali della macro che non hanno un tetto dedicato.
// - Consuntivo = quote di competenza confermate fino a oggi (regola delle Statistiche).
//   Impegnato = il resto dell'anno: quote future, programmati, da confermare, e
//   scadenze di ricorrenze e rate non ancora generate fino al 31 dicembre.
import { lineShares, slicesOf } from './basis';
import { convertCents } from './fx';
import { toCents } from './money';
import { occurrenceDates, scheduleOf } from './recurrence';
import type { Budget, BudgetLine, Category, Installment, Macro, Recurrence, ReferenceBalance, Transaction, TxKind } from './types';

export type LineNature = 'forecast' | 'dedicated' | 'common' | 'income';

const yearOf = (iso: string) => Number(iso.slice(0, 4));
const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at);

// ----- profilo mensile -------------------------------------------------------

/** 12 pesi che sommano esattamente a 100 (8,33 × 11 + 8,37). */
export function uniformProfile(): number[] {
  return spread(10000, 12).map((h) => h / 100);
}

/** Divide n centesimi di punto in parti uguali; l'ultima prende il resto. */
function spread(hundredths: number, n: number): number[] {
  const base = Math.floor(hundredths / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? hundredths - base * (n - 1) : base));
}

const toH = (w: number) => Math.round(w * 100);

/**
 * Ritocco di un mese: il valore scelto resta, i mesi già ritoccati (locked) restano,
 * gli altri si dividono il resto in parti uguali. La somma resta esattamente 100.
 */
export function setMonthWeight(weights: number[], locked: boolean[], month: number, value: number): number[] {
  const w = weights.map(toH);
  const lockedSum = w.reduce((s, x, i) => (i !== month && locked[i] ? s + x : s), 0);
  const free = w.map((_, i) => i).filter((i) => i !== month && !locked[i]);
  let v = Math.max(0, Math.min(toH(value), 10000 - lockedSum));
  if (free.length === 0) v = 10000 - lockedSum; // nessun mese libero: il valore deve chiudere a 100
  const out = [...w];
  out[month] = v;
  const parts = spread(10000 - lockedSum - v, free.length);
  free.forEach((i, k) => (out[i] = parts[k]));
  return out.map((h) => h / 100);
}

/** Profilo da importi mensili (centesimi per mese, 12 valori); null se non c'è nulla. */
export function profileFromMonths(monthCents: number[]): number[] | null {
  const total = monthCents.reduce((s, x) => s + Math.max(0, x), 0);
  if (total <= 0) return null;
  const h = monthCents.map((x) => Math.floor((Math.max(0, x) * 10000) / total));
  h[11] += 10000 - h.reduce((s, x) => s + x, 0);
  return h.map((x) => x / 100);
}

export const isUniform = (p: number[] | null) => !p || p.every((x, i) => toH(x) === toH(uniformProfile()[i]));

// ----- natura e perimetro di una riga ----------------------------------------

export function natureOf(line: BudgetLine, categories: Map<string, Category>, macros: Map<string, Macro>): LineNature {
  if (line.macro_id) return 'common';
  const c = categories.get(line.category_id!);
  if (!c) return 'forecast';
  if (macros.get(c.macro_id)?.tx_kind === 'income') return 'income';
  return c.flag === 'discretionary' ? 'dedicated' : 'forecast';
}

const kindOfCat = (c: Category, macros: Map<string, Macro>): TxKind => macros.get(c.macro_id)?.tx_kind ?? 'expense';

/** Categorie che una riga copre. Il tetto comune copre le discrezionali della macro senza tetto dedicato. */
export function membersOf(line: BudgetLine, lines: BudgetLine[], categories: Map<string, Category>): string[] {
  if (line.category_id) return [line.category_id];
  const own = new Set(live(lines).flatMap((l) => (l.category_id ? [l.category_id] : [])));
  return [...categories.values()]
    .filter((c) => !c.deleted_at && c.macro_id === line.macro_id && c.flag === 'discretionary' && !own.has(c.id))
    .map((c) => c.id);
}

// ----- programmato -----------------------------------------------------------

export interface ProgrammedItem {
  recurrenceId: string;
  name: string;
  categoryId: string;
  cents: number;
  count: number;      // scadenze dell'anno
  pending: number;    // di cui non ancora generate (centesimi): vanno nell'impegnato
}

export interface ProgrammedInput {
  year: number;
  recs: Recurrence[];
  installments: Installment[];
  txs: Transaction[];
  /** Ultimo cambio noto per valuta (valuta estera per 1 €), per le ricorrenze in valuta. */
  rates: Map<string, number>;
}

/**
 * Scadenze di ricorrenze e piani rate che cadono nell'anno. Quelle già generate
 * contano con l'importo del loro movimento (se cancellate, non contano); le altre
 * con la stima: importo fisso, ultimo confermato per le variabili, la rata per i piani.
 */
export function programmedItems(input: ProgrammedInput): ProgrammedItem[] {
  const { year, recs, installments, txs, rates } = input;
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const byRec = new Map<string, Transaction[]>();
  for (const t of txs) if (t.recurrence_id) byRec.set(t.recurrence_id, [...(byRec.get(t.recurrence_id) ?? []), t]);
  const out: ProgrammedItem[] = [];

  for (const rec of recs) {
    if (rec.deleted_at) continue;
    const mine = byRec.get(rec.id) ?? [];
    const item: ProgrammedItem = { recurrenceId: rec.id, name: rec.name, categoryId: rec.category_id, cents: 0, count: 0, pending: 0 };
    const seen = new Set(mine.map((t) => t.occurrence_date));
    // già generate: contano per quello che sono (una cancellata è una scadenza saltata)
    for (const t of mine) {
      const d = t.occurrence_date ?? t.tx_date;
      if (d < from || d > to || t.deleted_at) continue;
      item.cents += toCents(t.total);
      item.count++;
    }
    // non ancora generate: solo se la ricorrenza è attiva
    if (rec.active) {
      const foreign = rec.currency !== 'EUR' && rec.kind !== 'plan';
      const lastConfirmed = [...mine]
        .filter((t) => !t.deleted_at && t.status === 'confirmed')
        .sort((a, b) => (b.occurrence_date ?? '').localeCompare(a.occurrence_date ?? ''))[0];
      const estimate = (foreign ? lastConfirmed?.amount_original : lastConfirmed?.total) ?? rec.reference_amount ?? 0;
      const add = (date: string, amount: number) => {
        if (seen.has(date) || date < from || date > to || amount <= 0) return;
        let cents = toCents(amount);
        if (foreign) {
          const rate = rates.get(rec.currency);
          if (!rate) return; // senza un cambio noto la scadenza non si stima
          cents = convertCents(cents, rate);
        }
        item.cents += cents;
        item.pending += cents;
        item.count++;
      };
      if (rec.kind === 'plan') {
        for (const i of installments) if (i.recurrence_id === rec.id && !i.deleted_at) add(i.due_date, i.amount);
      } else {
        const s = scheduleOf(rec);
        if (s) for (const d of occurrenceDates(s, to)) add(d, estimate);
      }
    }
    if (item.count > 0) out.push(item);
  }
  return out;
}

export function sumByCategory(items: { categoryId: string; cents: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + i.cents);
  return m;
}

// ----- consuntivo e impegnato ------------------------------------------------

export interface Actuals {
  actual: Map<string, number>;    // centesimi per categoria
  committed: Map<string, number>;
}

/** Consuntivo e impegnato dell'anno per categoria, in competenza. */
export function actualsOf(txs: Transaction[], year: number, today: string, items: ProgrammedItem[]): Actuals {
  const actual = new Map<string, number>();
  const committed = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const tx of txs) {
    if (tx.deleted_at) continue;
    for (const s of slicesOf(tx, 'accrual', today)) {
      if (yearOf(s.date) !== year) continue;
      for (const sh of lineShares(tx, s.cents)) add(s.scheduled ? committed : actual, sh.line.category_id, sh.cents);
    }
  }
  // scadenze di ricorrenze e rate che l'app non ha ancora generato
  for (const i of items) if (i.pending > 0) add(committed, i.categoryId, i.pending);
  return { actual, committed };
}

// ----- storico di riferimento ------------------------------------------------

/** Storico di una categoria in un anno (centesimi), senza le straordinarie; null se non c'è. */
export function historyOfCategory(refs: ReferenceBalance[], categoryId: string, year: number): number | null {
  const rows = live(refs).filter((r) => r.year === year && r.category_id === categoryId && !r.extraordinary);
  if (rows.length === 0) return null;
  const annual = rows.filter((r) => r.month === null);
  return (annual.length > 0 ? annual : rows).reduce((s, r) => s + toCents(r.amount), 0);
}

/** Importi mensili (12 valori, centesimi) di un insieme di categorie, senza straordinarie. */
export function monthlyHistory(refs: ReferenceBalance[], categoryIds: string[], year: number): number[] {
  const set = new Set(categoryIds);
  const out = Array(12).fill(0);
  for (const r of live(refs)) {
    if (r.year !== year || r.extraordinary || r.month === null || !r.category_id || !set.has(r.category_id)) continue;
    out[r.month - 1] += toCents(r.amount);
  }
  return out;
}

/**
 * Storico che fa da base a una riga (anno precedente al budget). Per il tetto comune
 * è la somma delle sue categorie; il saldo di una macro intera vale solo se la macro
 * non ha essenziali né tetti dedicati (altrimenti non si sa dividere: proposta a mano).
 */
export function historyOfLine(
  line: BudgetLine, lines: BudgetLine[], refs: ReferenceBalance[], categories: Map<string, Category>, budgetYear: number,
): number | null {
  const y = budgetYear - 1;
  if (line.category_id) return historyOfCategory(refs, line.category_id, y);
  const members = membersOf(line, lines, categories);
  const parts = members.map((id) => historyOfCategory(refs, id, y)).filter((x): x is number => x !== null);
  if (parts.length > 0) return parts.reduce((s, x) => s + x, 0);
  const cats = [...categories.values()].filter((c) => !c.deleted_at && c.macro_id === line.macro_id);
  const pure = cats.every((c) => c.flag === 'discretionary') && members.length === cats.length;
  if (!pure) return null;
  const macroRows = live(refs).filter((r) => r.year === y && r.macro_id === line.macro_id && !r.extraordinary);
  if (macroRows.length === 0) return null;
  const annual = macroRows.filter((r) => r.month === null);
  return (annual.length > 0 ? annual : macroRows).reduce((s, r) => s + toCents(r.amount), 0);
}

/** Integrazione proposta dallo storico: storico × (1 + ritocco) − programmato, mai sotto zero. */
export function proposeIntegration(historyCents: number, adjustPct: number, programmedCents: number): number {
  return Math.max(0, Math.round(historyCents * (1 + adjustPct / 100)) - programmedCents);
}

/** Straordinarie dell'anno (centesimi): base della proposta di riserva. */
export function extraordinaryOf(refs: ReferenceBalance[], year: number): number {
  return live(refs).filter((r) => r.year === year && r.extraordinary).reduce((s, r) => s + toCents(r.amount), 0);
}

// ----- costruzione e bozza viva ---------------------------------------------

export interface LineDraft {
  category_id: string | null;
  macro_id: string | null;
  source: BudgetLine['source'];
  history_base: number | null; // euro
  adjust_pct: number | null;
  programmed_original: number; // euro
  integration_original: number;
}

/**
 * Righe proposte per un budget nuovo: una previsione per ogni essenziale, un tetto
 * comune per ogni macro con discrezionali, le entrate che hanno storico o ricorrenze.
 */
export function proposeLines(
  year: number, macros: Macro[], categories: Category[], refs: ReferenceBalance[], programmed: Map<string, number>,
): LineDraft[] {
  const macroById = new Map(macros.map((m) => [m.id, m]));
  const active = categories.filter((c) => !c.deleted_at && !c.archived && macroById.get(c.macro_id) && !macroById.get(c.macro_id)!.archived && !macroById.get(c.macro_id)!.deleted_at);
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const out: LineDraft[] = [];
  const draft = (category_id: string | null, macro_id: string | null, base: number | null, prog: number): LineDraft => ({
    category_id, macro_id,
    source: base !== null ? 'history' : 'manual',
    history_base: base !== null ? base / 100 : null,
    adjust_pct: base !== null ? 0 : null,
    programmed_original: prog / 100,
    integration_original: base !== null ? proposeIntegration(base, 0, prog) / 100 : 0,
  });
  for (const m of macros) {
    if (m.deleted_at || m.archived) continue;
    const cats = active.filter((c) => c.macro_id === m.id);
    if (m.tx_kind === 'income') {
      for (const c of cats) {
        const base = historyOfCategory(refs, c.id, year - 1);
        const prog = programmed.get(c.id) ?? 0;
        if ((base ?? 0) > 0 || prog > 0) out.push(draft(c.id, null, base, prog));
      }
      continue;
    }
    for (const c of cats.filter((x) => x.flag === 'essential')) {
      out.push(draft(c.id, null, historyOfCategory(refs, c.id, year - 1), programmed.get(c.id) ?? 0));
    }
    const disc = cats.filter((c) => c.flag === 'discretionary');
    if (disc.length > 0) {
      const probe = { macro_id: m.id, category_id: null, deleted_at: null } as BudgetLine;
      const base = historyOfLine(probe, [], refs, catMap, year);
      const prog = disc.reduce((s, c) => s + (programmed.get(c.id) ?? 0), 0);
      out.push(draft(null, m.id, base, prog));
    }
  }
  return out;
}

/** Programmato attuale di una riga (centesimi). */
export function programmedOfLine(line: BudgetLine, lines: BudgetLine[], categories: Map<string, Category>, programmed: Map<string, number>): number {
  return membersOf(line, lines, categories).reduce((s, id) => s + (programmed.get(id) ?? 0), 0);
}

/**
 * Bozza viva: il programmato segue sempre le ricorrenze; le voci non ancora toccate
 * seguono anche lo storico. Restituisce solo le righe che cambiano.
 */
export function refreshDraft(
  lines: BudgetLine[], categories: Map<string, Category>, refs: ReferenceBalance[], programmed: Map<string, number>, year: number,
): BudgetLine[] {
  const changed: BudgetLine[] = [];
  for (const l of live(lines)) {
    const prog = programmedOfLine(l, lines, categories, programmed) / 100;
    const next: BudgetLine = { ...l, programmed_original: prog };
    if (!l.reviewed) {
      const base = historyOfLine(l, lines, refs, categories, year);
      if (l.source === 'history' && base !== null) {
        next.history_base = base / 100;
        next.integration_original = proposeIntegration(base, l.adjust_pct ?? 0, toCents(prog)) / 100;
      } else if (l.source === 'history' && base === null) {
        next.source = 'manual';
        next.history_base = null;
        next.adjust_pct = null;
      } else if (l.source === 'manual' && base !== null && toCents(l.integration_original) === 0) {
        // è arrivato lo storico per una voce ancora vuota: la proposta passa allo storico
        next.source = 'history';
        next.history_base = base / 100;
        next.adjust_pct = 0;
        next.integration_original = proposeIntegration(base, 0, toCents(prog)) / 100;
      }
    }
    if (
      toCents(next.programmed_original) !== toCents(l.programmed_original) ||
      toCents(next.integration_original) !== toCents(l.integration_original) ||
      next.source !== l.source || next.history_base !== l.history_base
    ) changed.push(next);
  }
  return changed;
}

// ----- lettura -----------------------------------------------------------------

export const lineBudget = (l: BudgetLine): number => toCents(l.programmed_original) + toCents(l.integration_original);

/** Mese corrente dell'anno del budget: 1–12; 0 se l'anno deve ancora iniziare, 13 se è finito. */
export function monthIndex(year: number, today: string): number {
  const y = yearOf(today);
  if (y < year) return 0;
  if (y > year) return 13;
  return Number(today.slice(5, 7));
}

export interface LineReading {
  line: BudgetLine;
  nature: LineNature;
  members: string[];
  budget: number;
  actual: number;
  committed: number;
  available: number;
  /** Solo per i tetti. */
  ytdBudget: number | null;
  ytdDelta: number | null;  // consuntivo − budget YTD: negativo = sotto
  perMonth: number | null;  // quanto si può spendere nel mese corrente
}

export function readLine(
  line: BudgetLine, lines: BudgetLine[], categories: Map<string, Category>, macros: Map<string, Macro>, a: Actuals, month: number,
): LineReading {
  const nature = natureOf(line, categories, macros);
  const members = membersOf(line, lines, categories);
  const sum = (m: Map<string, number>) => members.reduce((s, id) => s + (m.get(id) ?? 0), 0);
  const budget = lineBudget(line);
  const actual = sum(a.actual);
  const committed = sum(a.committed);
  const available = budget - actual - committed;
  let ytdBudget: number | null = null;
  let ytdDelta: number | null = null;
  let perMonth: number | null = null;
  // prima che l'anno inizi YTD e "al mese" non dicono nulla
  if ((nature === 'common' || nature === 'dedicated') && month >= 1) {
    const w = (line.monthly_profile ?? uniformProfile()).map(toH);
    const elapsed = w.slice(0, Math.min(month, 12)).reduce((s, x) => s + x, 0);
    ytdBudget = Math.round((budget * elapsed) / 10000);
    ytdDelta = actual - ytdBudget;
    if (month >= 1 && month <= 12) {
      const rest = w.slice(month - 1).reduce((s, x) => s + x, 0);
      perMonth = rest > 0 ? Math.max(0, Math.round((available * w[month - 1]) / rest)) : 0;
    }
  }
  return { line, nature, members, budget, actual, committed, available, ytdBudget, ytdDelta, perMonth };
}

export interface BudgetReading {
  lines: LineReading[];
  expenseBudget: number;   // righe di uscita + riserva
  incomeBudget: number;
  reserve: number;
  primaryIncome: LineReading | null; // l'entrata più grande (lo stipendio)
  result: number;          // entrate a budget − uscite a budget
  resultPrimary: number;   // solo l'entrata principale − uscite a budget
  resultToDate: number;    // consuntivo entrate − consuntivo uscite, da inizio anno
  extraIncome: number;     // entrate senza budget (consuntivo)
  outOfBudget: number;     // uscite di categorie senza budget (consuntivo + impegnato)
}

export function readBudget(
  budget: Budget, lines: BudgetLine[], categories: Map<string, Category>, macros: Map<string, Macro>, a: Actuals, today: string,
): BudgetReading {
  const month = monthIndex(budget.year, today);
  const rows = live(lines).map((l) => readLine(l, lines, categories, macros, a, month));
  const reserve = toCents(budget.reserve_revised ?? budget.reserve_original);
  const exp = rows.filter((r) => r.nature !== 'income');
  const inc = rows.filter((r) => r.nature === 'income');
  const expenseBudget = exp.reduce((s, r) => s + r.budget, 0) + reserve;
  const incomeBudget = inc.reduce((s, r) => s + r.budget, 0);
  const primaryIncome = inc.length > 0 ? inc.reduce((a2, b) => (b.budget > a2.budget ? b : a2)) : null;

  const covered = new Set(rows.flatMap((r) => r.members));
  let incomeActual = 0, expenseActual = 0, extraIncome = 0, outOfBudget = 0;
  for (const [id, cents] of a.actual) {
    const c = categories.get(id);
    if (!c) continue;
    if (kindOfCat(c, macros) === 'income') {
      incomeActual += cents;
      if (!covered.has(id)) extraIncome += cents;
    } else {
      expenseActual += cents;
      if (!covered.has(id)) outOfBudget += cents;
    }
  }
  for (const [id, cents] of a.committed) {
    const c = categories.get(id);
    if (c && kindOfCat(c, macros) === 'expense' && !covered.has(id)) outOfBudget += cents;
  }
  return {
    lines: rows, expenseBudget, incomeBudget, reserve, primaryIncome,
    result: incomeBudget - expenseBudget,
    resultPrimary: (primaryIncome?.budget ?? 0) - expenseBudget,
    resultToDate: incomeActual - expenseActual,
    extraIncome, outOfBudget,
  };
}

export interface MacroReading {
  macro: Macro;
  forecast: LineReading[];   // previsioni delle essenziali
  caps: LineReading[];       // tetto comune e tetti dedicati
  budget: number;
  actual: number;
  committed: number;
  available: number;
  overCap: LineReading | null; // un tetto (comune o dedicato) oltre il budget
}

/** Righe raggruppate per macro di uscita, nell'ordine delle macro. */
export function byMacro(reading: BudgetReading, macros: Macro[], categories: Map<string, Category>): MacroReading[] {
  const out: MacroReading[] = [];
  for (const m of macros) {
    if (m.tx_kind !== 'expense') continue;
    const mine = reading.lines.filter((r) => (r.line.macro_id ?? categories.get(r.line.category_id!)?.macro_id) === m.id);
    if (mine.length === 0) continue;
    const forecast = mine.filter((r) => r.nature === 'forecast');
    const caps = mine.filter((r) => r.nature === 'common' || r.nature === 'dedicated')
      .sort((a, b) => (a.nature === 'dedicated' ? 0 : 1) - (b.nature === 'dedicated' ? 0 : 1));
    const sum = (k: 'budget' | 'actual' | 'committed' | 'available') => mine.reduce((s, r) => s + r[k], 0);
    out.push({
      macro: m, forecast, caps,
      budget: sum('budget'), actual: sum('actual'), committed: sum('committed'), available: sum('available'),
      overCap: caps.find((r) => r.available < 0) ?? null,
    });
  }
  return out;
}

/** Ripartizione indicativa del tetto comune sulle sue categorie, dalle quote dello storico. */
export function guideShares(members: string[], refs: ReferenceBalance[], year: number): Map<string, number> {
  const parts = members.map((id) => [id, historyOfCategory(refs, id, year) ?? 0] as const);
  const total = parts.reduce((s, [, x]) => s + x, 0);
  return new Map(parts.map(([id, x]) => [id, total > 0 ? x / total : 0]));
}
