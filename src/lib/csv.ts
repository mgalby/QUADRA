// Importazione da CSV: lettura del file, riconoscimento di formati e anteprima.
// Logica pura, senza schermo né database.
import type { TxKind } from './types';

// ----- testo e struttura del file -------------------------------------------

/** UTF-8 se valido, altrimenti Windows-1252 (Excel italiano). Toglie il BOM. */
export function decodeCsv(buf: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1252').decode(buf);
  }
  return text.replace(/^﻿/, '');
}

export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const count = (ch: string) => {
    let n = 0;
    let quoted = false;
    for (const c of first) {
      if (c === '"') quoted = !quoted;
      else if (c === ch && !quoted) n++;
    }
    return n;
  };
  const best = [';', '\t', ','].map((d) => [d, count(d)] as const).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ';';
}

/** Tabella di celle: virgolette doppie, separatore riconosciuto, righe vuote scartate. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n') endRow();
    else if (c === '\r') { if (text[i + 1] !== '\n') endRow(); }
    else cell += c;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

/** Cella di testo sicura per Excel: virgolette se serve, e niente formule iniettate. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+@]/.test(s) || /^-(?![\d.,]+$)/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ----- singoli valori ---------------------------------------------------------

/** Gruppi di migliaia ben formati: il primo di 1-3 cifre, gli altri di 3. */
const groupsOk = (parts: string[]) => parts[0].length >= 1 && parts[0].length <= 3 && parts.slice(1).every((p) => p.length === 3);

/** Importo in centesimi, con segno. "1.234,56", "1234.56", "-12,5", "12,50 €". */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (s === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[\s €$£¥]|EUR|USD|GBP|CHF/gi, '');
  if (s.startsWith('−') || s.startsWith('–')) s = `-${s.slice(1)}`;
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart: string;
  let frac = '';
  if (lastDot >= 0 && lastComma >= 0) {
    // l'ultimo dei due è il separatore decimale
    const dec = Math.max(lastDot, lastComma);
    intPart = s.slice(0, dec).replace(/[.,]/g, '');
    frac = s.slice(dec + 1);
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    const last = parts[parts.length - 1];
    if (parts.length > 2 || last.length === 3) { if (!groupsOk(parts)) return null; intPart = parts.join(''); } // 1,234 e 1,234,567: migliaia
    else { intPart = parts[0]; frac = last; }
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    const last = parts[parts.length - 1];
    if (parts.length > 2 || last.length === 3) { if (!groupsOk(parts)) return null; intPart = parts.join(''); } // 1.234: migliaia all'italiana
    else { intPart = parts[0]; frac = last; }
  } else intPart = s;
  if (!/^\d*$/.test(intPart) || !/^\d{0,2}$/.test(frac)) return null;
  const cents = Number(intPart || '0') * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

const pad = (n: number) => String(n).padStart(2, '0');
function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** GG/MM/AAAA, GG-MM-AAAA, GG.MM.AAAA (anche AA a due cifre) e AAAA-MM-GG, con o senza ora. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[\s,T].*)?$/);
  if (m) return validDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Mese di competenza: AAAA-MM, MM/AAAA, "nov 2026", "novembre 2026" o una data intera. */
export function parseMonth(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (s === '') return null;
  let m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(+m[2])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}`;
  m = s.match(/^([a-zà-ù]+)\.?\s+(\d{4})$/);
  if (m) {
    const key = m[1].slice(0, 3);
    const i = MONTHS.indexOf(key) >= 0 ? MONTHS.indexOf(key) : MONTHS_EN.indexOf(key);
    if (i >= 0) return `${m[2]}-${pad(i + 1)}`;
  }
  const d = parseDate(raw);
  return d ? d.slice(0, 7) : null;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export { norm as normalizeName };

/** Segno scritto in lettere o simboli; null se non riconosciuto. */
export function parseSign(raw: string): TxKind | null {
  const s = norm(raw);
  if (['u', 'uscita', 'uscite', 'spesa', 'spese', '-', '−', 'expense', 'out', 'debit', 'dare'].includes(s)) return 'expense';
  if (['e', 'entrata', 'entrate', 'incasso', '+', 'income', 'in', 'credit', 'avere'].includes(s)) return 'income';
  return null;
}

// ----- righe del file -----------------------------------------------------------

export interface CsvRow {
  line: number;              // numero di riga nel file (la prima è l'intestazione)
  date: string | null;
  signed: number | null;     // centesimi con il segno scritto nel file
  sign: TxKind | null;       // dalla colonna Segno, se c'è e riconosciuta
  category: string;
  merchant: string;
  note: string;
  month: string | null;      // competenza, se indicata
  currency: string | null;
  original: number | null;   // centesimi in valuta estera
  error: string | null;
}

export interface CsvTable {
  rows: CsvRow[];
  hasSign: boolean;          // c'è una colonna Segno
  hasNegative: boolean;      // almeno un importo con segno meno
  problem: string | null;    // file non leggibile (colonne mancanti, vuoto…)
}

const HEADERS: Record<string, string[]> = {
  date: ['data', 'date', 'data operazione', 'data movimento'],
  amount: ['importo', 'amount', 'totale', 'valore'],
  sign: ['segno', 'sign', 'tipo', 'type'],
  category: ['categoria', 'category'],
  merchant: ['esercizio', 'esercente', 'merchant', 'descrizione', 'description', 'beneficiario'],
  note: ['note', 'nota', 'notes', 'memo'],
  month: ['competenza', 'mese competenza', 'accrual'],
  currency: ['valuta', 'currency'],
  original: ['importooriginale', 'importo originale', 'original amount', 'amount original'],
};

export function readTable(table: string[][]): CsvTable {
  const empty = (problem: string): CsvTable => ({ rows: [], hasSign: false, hasNegative: false, problem });
  if (table.length < 2) return empty('empty');
  const header = table[0].map(norm);
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(HEADERS)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[key] = i;
  }
  if (col.date === undefined || col.amount === undefined) return empty('columns');

  const get = (cells: string[], key: string) => (col[key] === undefined ? '' : (cells[col[key]] ?? '').trim());
  let hasNegative = false;
  const rows: CsvRow[] = table.slice(1).map((cells, i) => {
    const date = parseDate(get(cells, 'date'));
    const rawAmount = get(cells, 'amount');
    const signed = parseAmount(rawAmount);
    const rawSign = get(cells, 'sign');
    const sign = rawSign === '' ? null : parseSign(rawSign);
    const rawMonth = get(cells, 'month');
    const cur = get(cells, 'currency').toUpperCase();
    const orig = get(cells, 'original');
    if (signed !== null && signed < 0) hasNegative = true;
    let error: string | null = null;
    if (!date) error = 'date';
    else if (signed === null) error = 'amount';
    else if (signed === 0) error = 'zero';
    else if (rawSign !== '' && !sign) error = 'sign';
    else if (rawMonth !== '' && !parseMonth(rawMonth)) error = 'month';
    const original = orig === '' ? null : parseAmount(orig);
    return {
      line: i + 2,
      date,
      signed,
      sign,
      category: get(cells, 'category'),
      merchant: get(cells, 'merchant'),
      note: get(cells, 'note'),
      month: rawMonth === '' ? null : parseMonth(rawMonth),
      currency: /^[A-Z]{3}$/.test(cur) ? cur : null,
      original: original === null ? null : Math.abs(original),
      error,
    };
  });
  return { rows, hasSign: col.sign !== undefined, hasNegative, problem: null };
}

// ----- anteprima ---------------------------------------------------------------

export interface CategoryInfo { id: string; name: string; kind: TxKind }
export interface ExistingTx { date: string; kind: TxKind; cents: number }

export type ItemStatus = 'ok' | 'dup' | 'nocat' | 'error';
export interface ImportItem {
  row: CsvRow;
  kind: TxKind;
  cents: number;             // sempre positivo
  categoryId: string | null;
  from: 'file' | 'merchant' | 'manual' | null; // da dove arriva la categoria
  status: ItemStatus;
}

export interface PreviewContext {
  categories: CategoryInfo[];
  /** Categoria abituale per esercizio (nome normalizzato) e tipo. */
  merchantTop: Map<string, Partial<Record<TxKind, string>>>;
  existing: ExistingTx[];
  /** Scelte dell'utente: nome categoria normalizzato (anche vuoto) + tipo → categoria. */
  catMap: Record<string, string>;
  /** Senza colonna Segno e senza importi negativi: gli importi positivi sono… */
  positiveIs: TxKind;
}

export const catKey = (name: string, kind: TxKind) => `${kind}:${norm(name.split(/\s*[>/]\s*/).pop() ?? name)}`;

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

export function kindOf(row: CsvRow, table: Pick<CsvTable, 'hasNegative'>, positiveIs: TxKind): TxKind {
  if (row.sign) return row.sign;
  if (table.hasNegative) return (row.signed ?? 0) < 0 ? 'expense' : 'income';
  return positiveIs;
}

export function buildPreview(table: CsvTable, ctx: PreviewContext): ImportItem[] {
  const byKindName = new Map<string, string>();
  for (const c of ctx.categories) byKindName.set(`${c.kind}:${norm(c.name)}`, c.id);
  const byKind = (kind: TxKind) => ctx.existing.filter((e) => e.kind === kind);
  const existing = { expense: byKind('expense'), income: byKind('income') };

  return table.rows.map((row): ImportItem => {
    const kind = kindOf(row, table, ctx.positiveIs);
    const cents = Math.abs(row.signed ?? 0);
    if (row.error) return { row, kind, cents, categoryId: null, from: null, status: 'error' };

    const key = catKey(row.category, kind);
    let categoryId: string | null = null;
    let from: ImportItem['from'] = null;
    if (ctx.catMap[key]) { categoryId = ctx.catMap[key]; from = 'manual'; }
    else if (row.category.trim() !== '' && byKindName.has(key)) { categoryId = byKindName.get(key)!; from = 'file'; }
    else if (row.merchant.trim() !== '') {
      const top = ctx.merchantTop.get(norm(row.merchant))?.[kind];
      if (top) { categoryId = top; from = 'merchant'; }
    }

    const day = dayNumber(row.date!);
    const dup = existing[kind].some((e) => e.cents === cents && Math.abs(dayNumber(e.date) - day) <= 3);
    const status: ItemStatus = categoryId === null ? 'nocat' : dup ? 'dup' : 'ok';
    return { row, kind, cents, categoryId, from, status };
  });
}
