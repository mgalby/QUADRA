import type { QuadraDB } from './db';
import { addDays, todayISO } from './dates';
import { fromCents } from './money';
import { sortLines } from './split';
import type { Category, Merchant, Transaction, TxKind, TxLine } from './types';

// Operazioni sui dati locali. Ogni scrittura mette anche una voce nella coda
// di invio, nella stessa transazione: o si salvano entrambe o nessuna.

const now = () => new Date().toISOString();

export interface TxInput {
  id?: string;               // presente = modifica di un movimento esistente
  kind: TxKind;
  cents: number;
  date: string;
  merchantName: string;
  note: string;
  categoryId: string;        // categoria del movimento normale
  split?: { categoryId: string; cents: number }[]; // dividi scontrino: due o più righe che sommano al totale
}

/** Cerca l'esercizio per nome (maiuscole ignorate) o lo crea. */
export async function findOrCreateMerchant(db: QuadraDB, name: string): Promise<string | null> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean === '') return null;
  const lower = clean.toLowerCase();
  const existing = (await db.merchants.toArray()).find((m) => !m.deleted_at && m.name.toLowerCase() === lower);
  if (existing) return existing.merged_into_id ?? existing.id;
  const merchant: Merchant = { id: crypto.randomUUID(), name: clean, merged_into_id: null, client_modified_at: now(), deleted_at: null };
  await db.merchants.put(merchant);
  await db.outbox.put({ key: `merchant:${merchant.id}`, kind: 'merchant', id: merchant.id });
  return merchant.id;
}

export async function saveTransaction(db: QuadraDB, input: TxInput): Promise<Transaction> {
  if (input.split) {
    const sum = input.split.reduce((s, l) => s + l.cents, 0);
    if (input.kind !== 'expense' || input.split.length < 2 || sum !== input.cents || input.split.some((l) => l.cents <= 0)) {
      throw new Error('Divisione non valida: le righe devono sommare al totale');
    }
  }
  return db.transaction('rw', [db.transactions, db.merchants, db.outbox], async () => {
    const previous = input.id ? await db.transactions.get(input.id) : undefined;
    const total = fromCents(input.cents);
    // l'override del flag resta solo se la categoria della riga è rimasta la stessa
    const overrideFor = (categoryId: string) => previous?.lines.find((l) => l.category_id === categoryId)?.flag_override ?? null;
    const lines: TxLine[] = input.split
      ? sortLines(input.split.map((l) => ({ category_id: l.categoryId, amount: fromCents(l.cents), flag_override: overrideFor(l.categoryId) })))
      : [{ category_id: input.categoryId, amount: total, flag_override: overrideFor(input.categoryId) }];
    const tx: Transaction = {
      id: input.id ?? crypto.randomUUID(),
      tx_kind: input.kind,
      total,
      tx_date: input.date,
      merchant_id: await findOrCreateMerchant(db, input.merchantName),
      note: input.note.trim() || null,
      status: 'confirmed', // una data futura si mostra come "programmato" finché non arriva; salvare conferma anche una scadenza da confermare
      accrual_mode: previous?.accrual_mode ?? 'same',
      fx_status: previous?.fx_status ?? 'none',
      recurrence_id: previous?.recurrence_id ?? null,
      occurrence_date: previous?.occurrence_date ?? null,
      installment_id: previous?.installment_id ?? null,
      client_modified_at: now(),
      deleted_at: null,
      lines,
    };
    await db.transactions.put(tx);
    await db.outbox.put({ key: `tx:${tx.id}`, kind: 'tx', id: tx.id });
    return tx;
  });
}

/** Cancellazione logica: il movimento sparisce subito e la cancellazione viaggia al server. */
export async function deleteTransaction(db: QuadraDB, id: string): Promise<void> {
  await db.transaction('rw', [db.transactions, db.outbox], async () => {
    const tx = await db.transactions.get(id);
    if (!tx) return;
    await db.transactions.put({ ...tx, deleted_at: now(), client_modified_at: now() });
    await db.outbox.put({ key: `tx:${id}`, kind: 'tx', id });
  });
}

// ----- griglia delle categorie e suggerimenti ------------------------------

const GRID_SIZE = 9;
// Ordine del primo giorno, quando non c'è ancora storia d'uso (deciso il 14 nov 2026).
const STARTING_NINE = [
  'Spesa alimentare', 'Bar e aperitivi', 'Benzina', 'Cene e pranzi fuori', 'Cose per la casa',
  'Animali', 'Ragazzi', 'Fotografia', 'Bollette',
];

/**
 * Categorie della griglia, dalla più usata negli ultimi 90 giorni.
 * L'ordine si ricalcola una volta al giorno, così i pulsanti non si spostano
 * sotto il dito mentre si inseriscono più spese di seguito.
 */
export async function gridCategories(db: QuadraDB, kind: TxKind, categories: Category[]): Promise<Category[]> {
  const today = todayISO();
  const key = `grid:${kind}`;
  const usable = new Map(categories.map((c) => [c.id, c]));
  const cached = await db.meta.get(key);
  if (cached) {
    const { date, ids } = JSON.parse(cached.value) as { date: string; ids: string[] };
    const list = ids.map((id) => usable.get(id)).filter((c): c is Category => !!c);
    if (date === today && (list.length === GRID_SIZE || list.length === categories.length)) return list;
  }

  const uses = new Map<string, number>();
  const recent = await db.transactions.where('tx_date').aboveOrEqual(addDays(today, -90)).toArray();
  for (const tx of recent) {
    if (tx.deleted_at || tx.tx_kind !== kind) continue;
    for (const l of tx.lines) uses.set(l.category_id, (uses.get(l.category_id) ?? 0) + 1);
  }
  const startRank = (c: Category) => {
    const i = STARTING_NINE.indexOf(c.name);
    return i === -1 ? STARTING_NINE.length + c.sort_order : i;
  };
  const ranked = [...categories].sort(
    (a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || startRank(a) - startRank(b) || a.name.localeCompare(b.name),
  );
  // le categorie fissate dall'utente vanno nella loro casella
  const pinned = ranked.filter((c) => c.pinned_slot).sort((a, b) => a.pinned_slot! - b.pinned_slot!);
  const grid = ranked.filter((c) => !c.pinned_slot).slice(0, GRID_SIZE);
  for (const c of pinned) grid.splice(Math.min(c.pinned_slot! - 1, grid.length), 0, c);
  const result = grid.slice(0, GRID_SIZE);

  await db.meta.put({ key, value: JSON.stringify({ date: today, ids: result.map((c) => c.id) }) });
  return result;
}

export interface MerchantStats {
  merchant: Merchant;
  uses: number;                       // negli ultimi 90 giorni
  lastUsed: string;
  topCategory: Record<TxKind, string | null>; // categoria abituale, per tipo di movimento
}

/** Esercizi con frequenza d'uso e categoria abituale, dal più usato. */
export async function merchantStats(db: QuadraDB): Promise<MerchantStats[]> {
  const [merchants, txs] = await Promise.all([db.merchants.toArray(), db.transactions.toArray()]);
  const since = addDays(todayISO(), -90);
  const byId = new Map<string, { uses: number; last: string; cats: Record<TxKind, Map<string, number>> }>();
  for (const tx of txs) {
    if (tx.deleted_at || !tx.merchant_id) continue;
    const s = byId.get(tx.merchant_id) ?? { uses: 0, last: '', cats: { expense: new Map(), income: new Map() } };
    if (tx.tx_date >= since) s.uses++;
    if (tx.tx_date > s.last) s.last = tx.tx_date;
    for (const l of tx.lines) s.cats[tx.tx_kind].set(l.category_id, (s.cats[tx.tx_kind].get(l.category_id) ?? 0) + 1);
    byId.set(tx.merchant_id, s);
  }
  const top = (m?: Map<string, number>) => (m && m.size ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : null);
  return merchants
    .filter((m) => !m.deleted_at && !m.merged_into_id)
    .map((merchant) => {
      const s = byId.get(merchant.id);
      return {
        merchant,
        uses: s?.uses ?? 0,
        lastUsed: s?.last ?? '',
        topCategory: { expense: top(s?.cats.expense), income: top(s?.cats.income) },
      };
    })
    .sort((a, b) => b.uses - a.uses || b.lastUsed.localeCompare(a.lastUsed) || a.merchant.name.localeCompare(b.merchant.name));
}
