import { useSyncExternalStore } from 'react';
import type { QuadraDB } from './db';
import { supabase } from './supabase';
import type { Category, Installment, Macro, Merchant, Profile, Recurrence, Transaction, TxLine } from './types';
import { accrualsOf, paymentsOf } from './basis';
import { sortLines } from './split';

// ---------------------------------------------------------------------------
// Sincronizzazione con Supabase.
// Ordine fisso: prima si invia la coda locale (esercizi e macro, categorie,
// ricorrenze, movimenti), poi si scaricano le novità. Così il server non sovrascrive mai una
// modifica locale non ancora partita.
// ---------------------------------------------------------------------------

export type SyncState =
  | { status: 'idle' | 'syncing' | 'ok' | 'offline' }
  | { status: 'error'; msg: string };

let state: SyncState = { status: 'idle' };
const listeners = new Set<() => void>();
function setState(next: SyncState) {
  state = next;
  listeners.forEach((l) => l());
}
export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
export const markOffline = () => setState({ status: 'offline' });

/** Errore di rete: si riprova più tardi, la coda resta com'è. */
class NetworkError extends Error {}

function check(error: { message: string; code?: string } | null): void {
  if (!error) return;
  // senza rete supabase-js restituisce un errore senza codice Postgres
  if (!navigator.onLine || /fetch|network|load failed/i.test(error.message)) throw new NetworkError(error.message);
  throw Object.assign(new Error(error.message), { code: error.code });
}

// ----- invio ---------------------------------------------------------------

async function pushMerchant(db: QuadraDB, id: string): Promise<void> {
  const local = await db.merchants.get(id);
  if (!local) return;
  const { error } = await supabase.from('merchants').upsert({
    id: local.id,
    name: local.name,
    merged_into_id: local.merged_into_id,
    client_modified_at: local.client_modified_at,
    deleted_at: local.deleted_at,
  });
  if (error?.code !== '23505') return check(error);

  // Stesso nome già creato da un altro dispositivo: si adotta quello del server
  // e i movimenti locali vengono agganciati a lui.
  const all = await supabase.from('merchants').select('*').is('deleted_at', null);
  check(all.error);
  const twin = (all.data as Merchant[]).find((m) => m.name.toLowerCase() === local.name.toLowerCase());
  if (!twin) throw new Error(`Esercizio duplicato non trovato: ${local.name}`);
  await db.transaction('rw', [db.merchants, db.transactions], async () => {
    await db.transactions.where('merchant_id').equals(local.id).modify({ merchant_id: twin.id });
    await db.merchants.delete(local.id);
    await db.merchants.put(toMerchant(twin));
  });
}

async function pushMacro(db: QuadraDB, id: string): Promise<void> {
  const m = await db.macros.get(id);
  if (!m) return;
  const { error } = await supabase.from('macros').upsert({
    id: m.id, tx_kind: m.tx_kind, name: m.name, icon: m.icon, color: m.color, sort_order: m.sort_order,
    archived: m.archived, client_modified_at: m.client_modified_at, deleted_at: m.deleted_at,
  });
  check(error);
}

async function pushCategory(db: QuadraDB, id: string): Promise<void> {
  const c = await db.categories.get(id);
  if (!c) return;
  const { error } = await supabase.from('categories').upsert({
    id: c.id, macro_id: c.macro_id, name: c.name, icon: c.icon, shade: c.shade, flag: c.flag,
    pinned_slot: c.pinned_slot, sort_order: c.sort_order, archived: c.archived,
    client_modified_at: c.client_modified_at, deleted_at: c.deleted_at,
  });
  check(error);
}

async function pushRecurrence(db: QuadraDB, id: string): Promise<void> {
  const r = await db.recurrences.get(id);
  if (!r) return;
  const rec = await supabase.from('recurrences').upsert({
    id: r.id, name: r.name, kind: r.kind, tx_kind: r.tx_kind, category_id: r.category_id,
    merchant_id: r.merchant_id, note: r.note, reference_amount: r.reference_amount, currency: r.currency,
    interval_n: r.interval_n, interval_unit: r.interval_unit, anchor: r.anchor, anchor_day: r.anchor_day,
    start_date: r.start_date, end_date: r.end_date, max_occurrences: r.max_occurrences,
    notify_days_before: r.notify_days_before, active: r.active,
    client_modified_at: r.client_modified_at, deleted_at: r.deleted_at,
  });
  check(rec.error);
  // le rate viaggiano con il loro piano
  const rows = await db.installments.where('recurrence_id').equals(id).toArray();
  if (rows.length === 0) return;
  const inst = await supabase.from('plan_installments').upsert(
    rows.map((i) => ({
      id: i.id, recurrence_id: i.recurrence_id, seq: i.seq, due_date: i.due_date, amount: i.amount,
      mode: i.mode, client_modified_at: i.client_modified_at, deleted_at: i.deleted_at,
    })),
  );
  check(inst.error);
}

async function pushTransaction(db: QuadraDB, id: string): Promise<string | null> {
  const tx = await db.transactions.get(id);
  if (!tx) return null;
  if (tx.deleted_at) {
    const { error } = await supabase.rpc('delete_transaction', { p_id: tx.id });
    check(error);
    return tx.client_modified_at;
  }
  const { error } = await supabase.rpc('save_transaction', {
    p: {
      id: tx.id,
      tx_kind: tx.tx_kind,
      total: tx.total,
      tx_date: tx.tx_date,
      merchant_id: tx.merchant_id,
      note: tx.note,
      status: tx.status,
      accrual_mode: tx.accrual_mode,
      ...(tx.fx_status !== 'none' && tx.currency
        ? { currency: tx.currency, amount_original: tx.amount_original, fx_rate: tx.fx_rate, fx_status: tx.fx_status }
        : {}),
      recurrence_id: tx.recurrence_id,
      occurrence_date: tx.occurrence_date,
      installment_id: tx.installment_id,
      client_modified_at: tx.client_modified_at,
      lines: tx.lines,
      payments: paymentsOf(tx).map((p) => ({ pay_date: p.pay_date, amount: p.amount })),
      accruals: accrualsOf(tx).map((a) => ({ period: a.period, amount: a.amount })),
    },
  });
  check(error);
  return tx.client_modified_at;
}

async function pushOutbox(db: QuadraDB): Promise<string | null> {
  const entries = await db.outbox.toArray();
  // ognuno referenzia i precedenti: esercizi e macro, poi categorie, ricorrenze, infine i movimenti
  const rank = { merchant: 0, macro: 0, cat: 1, rec: 2, tx: 3 } as const;
  entries.sort((a, b) => rank[a.kind] - rank[b.kind]);
  let firstError: string | null = null;

  for (const entry of entries) {
    try {
      if (entry.kind === 'merchant' || entry.kind === 'macro' || entry.kind === 'cat') {
        const table = entry.kind === 'merchant' ? db.merchants : entry.kind === 'macro' ? db.macros : db.categories;
        const sent = (await table.get(entry.id))?.client_modified_at;
        if (entry.kind === 'merchant') await pushMerchant(db, entry.id);
        else if (entry.kind === 'macro') await pushMacro(db, entry.id);
        else await pushCategory(db, entry.id);
        // se nel frattempo la riga è stata modificata di nuovo, resta in coda
        await db.transaction('rw', [db.outbox, table], async () => {
          const cur = await table.get(entry.id);
          if (cur && cur.client_modified_at !== sent) return;
          await db.outbox.delete(entry.key);
        });
      } else if (entry.kind === 'rec') {
        await pushRecurrence(db, entry.id);
        await db.outbox.delete(entry.key);
      } else {
        const sent = await pushTransaction(db, entry.id);
        // se nel frattempo il movimento è stato modificato di nuovo, resta in coda
        await db.transaction('rw', [db.outbox, db.transactions], async () => {
          const now = await db.transactions.get(entry.id);
          if (now && now.client_modified_at !== sent) return;
          await db.outbox.delete(entry.key);
          // le scadenze cancellate restano come traccia, per non essere rigenerate
          if (now?.deleted_at && !now.recurrence_id) await db.transactions.delete(entry.id);
        });
      }
    } catch (e) {
      if (e instanceof NetworkError) throw e;
      // errore di contenuto (es. categoria non valida): resta in coda, si prosegue con gli altri
      const msg = e instanceof Error ? e.message : String(e);
      await db.outbox.update(entry.key, { error: msg });
      firstError ??= msg;
    }
  }
  return firstError;
}

// ----- scarico -------------------------------------------------------------

const toMerchant = (m: Merchant): Merchant => ({
  id: m.id,
  name: m.name,
  merged_into_id: m.merged_into_id,
  client_modified_at: m.client_modified_at,
  deleted_at: m.deleted_at,
});

type ServerTx = Transaction & {
  updated_at: string;
  transaction_lines: TxLine[];
  payments: { pay_date: string; amount: number | string }[];
  accruals: { period: string; amount: number | string }[];
};
type ServerMerchant = Merchant & { updated_at: string };

async function pullMasterData(db: QuadraDB, userId: string): Promise<void> {
  const [profile, macros, categories] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('macros').select('*'),
    supabase.from('categories').select('*'),
  ]);
  check(profile.error ?? macros.error ?? categories.error);
  // Macro e categorie sono poche: si riallinea tutto a ogni scarico. Le righe con una
  // modifica locale non ancora inviata non si toccano, altrimenti il server la cancellerebbe.
  await db.transaction('rw', [db.profile, db.macros, db.categories, db.outbox], async () => {
    await db.profile.put(profile.data as Profile);
    const waiting = new Set((await db.outbox.toArray()).map((o) => o.key));
    // cosa togliere (sparito dal server) e cosa riscrivere, lasciando stare le righe in attesa di invio
    const plan = <T extends { id: string }>(local: T[], rows: T[], prefix: string) => {
      const onServer = new Set(rows.map((r) => r.id));
      return {
        gone: local.filter((r) => !onServer.has(r.id) && !waiting.has(`${prefix}:${r.id}`)).map((r) => r.id),
        put: rows.filter((r) => !waiting.has(`${prefix}:${r.id}`)),
      };
    };
    const m = plan(await db.macros.toArray(), macros.data as Macro[], 'macro');
    await db.macros.bulkDelete(m.gone);
    await db.macros.bulkPut(m.put);
    const c = plan(await db.categories.toArray(), categories.data as Category[], 'cat');
    await db.categories.bulkDelete(c.gone);
    await db.categories.bulkPut(c.put);
  });
}

const PAGE = 500;

/** Scarica le righe modificate dopo l'ultimo scarico, a pagine. */
async function pullSince<T extends { id: string; updated_at: string }>(
  db: QuadraDB,
  table: 'transactions' | 'merchants' | 'recurrences' | 'plan_installments',
  columns: string,
  store: (rows: T[]) => Promise<void>,
): Promise<void> {
  const cursorKey = `cursor:${table}`;
  let cursor = (await db.meta.get(cursorKey))?.value ?? '1970-01-01T00:00:00Z';
  for (;;) {
    // "maggiore o uguale" + ordinamento per id: nessuna riga persa se due hanno la stessa ora
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .gte('updated_at', cursor)
      .order('updated_at')
      .order('id')
      .limit(PAGE);
    check(error);
    const rows = (data ?? []) as unknown as T[];
    await store(rows);
    if (rows.length === 0) return;
    const last = rows[rows.length - 1].updated_at;
    await db.meta.put({ key: cursorKey, value: last });
    // pagina non piena, oppure tutte le righe con la stessa ora (non si può avanzare): finito
    if (rows.length < PAGE || last === cursor) return;
    cursor = last;
  }
}

async function pullMerchants(db: QuadraDB): Promise<void> {
  await pullSince<ServerMerchant>(db, 'merchants', '*', async (rows) => {
    await db.transaction('rw', [db.merchants, db.outbox], async () => {
      for (const row of rows) {
        if (await db.outbox.get(`merchant:${row.id}`)) continue; // modifica locale in attesa
        await db.merchants.put(toMerchant(row));
      }
    });
  });
}

async function pullTransactions(db: QuadraDB): Promise<void> {
  await pullSince<ServerTx>(
    db,
    'transactions',
    '*, transaction_lines(category_id, amount, flag_override), payments(pay_date, amount), accruals(period, amount)',
    async (rows) => {
      await db.transaction('rw', [db.transactions, db.outbox], async () => {
        for (const row of rows) {
          if (await db.outbox.get(`tx:${row.id}`)) continue; // modifica locale in attesa
          // senza ricorrenza una cancellazione si dimentica; con ricorrenza resta come traccia
          if (row.deleted_at && !row.recurrence_id) {
            await db.transactions.delete(row.id);
            continue;
          }
          await db.transactions.put({
            id: row.id,
            tx_kind: row.tx_kind,
            total: Number(row.total),
            tx_date: row.tx_date,
            merchant_id: row.merchant_id,
            note: row.note,
            status: row.status,
            accrual_mode: row.accrual_mode,
            fx_status: row.fx_status,
            currency: row.fx_status === 'none' ? undefined : row.currency,
            amount_original: row.amount_original == null ? null : Number(row.amount_original),
            fx_rate: row.fx_rate == null ? null : Number(row.fx_rate),
            recurrence_id: row.recurrence_id,
            occurrence_date: row.occurrence_date,
            installment_id: row.installment_id,
            client_modified_at: row.client_modified_at,
            deleted_at: row.deleted_at,
            lines: sortLines(row.transaction_lines.map((l) => ({ ...l, amount: Number(l.amount) }))),
            payments: (row.payments ?? []).map((p) => ({ pay_date: p.pay_date, amount: Number(p.amount) })),
            accruals: (row.accruals ?? []).map((a) => ({ period: a.period, amount: Number(a.amount) })),
          });
        }
      });
    },
  );
}

async function pullRecurrences(db: QuadraDB): Promise<void> {
  await pullSince<Recurrence & { updated_at: string }>(db, 'recurrences', '*', async (rows) => {
    await db.transaction('rw', [db.recurrences, db.outbox], async () => {
      for (const row of rows) {
        if (await db.outbox.get(`rec:${row.id}`)) continue; // modifica locale in attesa
        await db.recurrences.put({
          id: row.id, name: row.name, kind: row.kind, tx_kind: row.tx_kind, category_id: row.category_id,
          merchant_id: row.merchant_id, note: row.note,
          reference_amount: row.reference_amount === null ? null : Number(row.reference_amount),
          currency: row.currency, interval_n: row.interval_n, interval_unit: row.interval_unit,
          anchor: row.anchor, anchor_day: row.anchor_day, start_date: row.start_date, end_date: row.end_date,
          max_occurrences: row.max_occurrences, notify_days_before: row.notify_days_before, active: row.active,
          client_modified_at: row.client_modified_at, deleted_at: row.deleted_at,
        });
      }
    });
  });
}

async function pullInstallments(db: QuadraDB): Promise<void> {
  await pullSince<Installment & { updated_at: string }>(db, 'plan_installments', '*', async (rows) => {
    await db.transaction('rw', [db.installments, db.outbox], async () => {
      for (const row of rows) {
        if (await db.outbox.get(`rec:${row.recurrence_id}`)) continue; // il piano ha modifiche locali in attesa
        await db.installments.put({
          id: row.id, recurrence_id: row.recurrence_id, seq: row.seq, due_date: row.due_date,
          amount: Number(row.amount), mode: row.mode, client_modified_at: row.client_modified_at, deleted_at: row.deleted_at,
        });
      }
    });
  });
}

// ----- punto d'ingresso ----------------------------------------------------

let running: Promise<void> | null = null;
let again = false;

/**
 * Avvia una sincronizzazione. Se una è già in corso ne prenota un'altra
 * subito dopo, così un movimento salvato nel frattempo parte comunque.
 */
export function syncNow(db: QuadraDB, userId: string): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      if (!navigator.onLine) {
        setState({ status: 'offline' });
        return;
      }
      setState({ status: 'syncing' });
      try {
        const pushError = await pushOutbox(db);
        await pullMasterData(db, userId);
        await pullMerchants(db);
        await pullRecurrences(db);
        await pullInstallments(db);
        await pullTransactions(db);
        await db.meta.put({ key: 'last_sync', value: new Date().toISOString() });
        setState(pushError ? { status: 'error', msg: pushError } : { status: 'ok' });
      } catch (e) {
        if (e instanceof NetworkError || !navigator.onLine) setState({ status: 'offline' });
        else setState({ status: 'error', msg: e instanceof Error ? e.message : String(e) });
        return;
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}
