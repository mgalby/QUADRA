import type { QuadraDB } from './db';
import { findOrCreateMerchant } from './data';
import { addDays } from './dates';
import { convertCents, getRate } from './fx';
import { fromCents, toCents } from './money';
import { occurrenceDates, scheduleOf, splitInstallments, stableId, type Schedule } from './recurrence';
import type { Installment, Recurrence, Transaction, TxKind } from './types';

// Ricorrenze e piani rate sul dispositivo. Come per i movimenti, ogni scrittura
// mette una voce in coda di invio nella stessa transazione.

const now = () => new Date().toISOString();
/** Quanti giorni in avanti si preparano le scadenze (appaiono come "programmate"). */
export const LOOKAHEAD_DAYS = 30;

export interface RecurrenceInput {
  id?: string;
  kind: 'fixed' | 'variable';
  txKind: TxKind;
  name: string;
  cents: number;
  currency?: string; // valuta dell'importo; assente = quella già salvata o euro
  categoryId: string;
  merchantName: string;
  note: string;
  schedule: Schedule;
}

const queueRec = (db: QuadraDB, id: string) => db.outbox.put({ key: `rec:${id}`, kind: 'rec', id });
const queueTx = (db: QuadraDB, id: string) => db.outbox.put({ key: `tx:${id}`, kind: 'tx', id });

/** Crea o modifica una ricorrenza fissa o variabile e riallinea le scadenze future. */
export async function saveRecurrence(db: QuadraDB, input: RecurrenceInput, today: string): Promise<Recurrence> {
  let kindChanged = false;
  const rec = await db.transaction('rw', [db.recurrences, db.merchants, db.outbox], async () => {
    const previous = input.id ? await db.recurrences.get(input.id) : undefined;
    kindChanged = !!previous && previous.kind !== input.kind;
    const merchantId = await findOrCreateMerchant(db, input.merchantName);
    const s = input.schedule;
    const r: Recurrence = {
      id: input.id ?? crypto.randomUUID(),
      name: input.name.trim(),
      kind: input.kind,
      tx_kind: input.txKind,
      category_id: input.categoryId,
      merchant_id: merchantId,
      note: input.note.trim() || null,
      reference_amount: fromCents(input.cents),
      currency: previous?.currency ?? input.currency ?? 'EUR',
      interval_n: s.interval_n,
      interval_unit: s.interval_unit,
      anchor: s.interval_unit === 'month' || s.interval_unit === 'year' ? s.anchor : null,
      anchor_day: s.anchor === 'day_of_month' ? s.anchor_day : null,
      start_date: s.start_date,
      end_date: s.end_date,
      max_occurrences: s.max_occurrences,
      notify_days_before: previous?.notify_days_before ?? 1,
      active: true,
      client_modified_at: now(),
      deleted_at: null,
    };
    await db.recurrences.put(r);
    await queueRec(db, r.id);
    return r;
  });
  await reconcileFuture(db, rec, today, kindChanged);
  return rec;
}

export interface PlanInput {
  name: string;
  txKind: TxKind;
  totalCents: number;
  count: number;
  firstDue: string;
  categoryId: string;
  merchantName: string;
  note: string;
  mode: 'auto' | 'confirm';
}

/** Piano rate: una ricorrenza di tipo "plan" con le sue rate già calcolate. */
export async function savePlan(db: QuadraDB, input: PlanInput): Promise<Recurrence> {
  return db.transaction('rw', [db.recurrences, db.installments, db.merchants, db.outbox], async () => {
    const merchantId = await findOrCreateMerchant(db, input.merchantName);
    const day = Number(input.firstDue.slice(8, 10));
    const dates = occurrenceDates(
      { interval_n: 1, interval_unit: 'month', anchor: 'day_of_month', anchor_day: day, start_date: input.firstDue, end_date: null, max_occurrences: input.count },
      '2100-12-31',
    );
    const amounts = splitInstallments(input.totalCents, input.count);
    const stamp = now();
    const rec: Recurrence = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      kind: 'plan',
      tx_kind: input.txKind,
      category_id: input.categoryId,
      merchant_id: merchantId,
      note: input.note.trim() || null,
      reference_amount: fromCents(input.totalCents),
      currency: 'EUR',
      interval_n: 1,
      interval_unit: 'month',
      anchor: 'day_of_month',
      anchor_day: day,
      start_date: input.firstDue,
      end_date: null,
      max_occurrences: input.count,
      notify_days_before: 1,
      active: true,
      client_modified_at: stamp,
      deleted_at: null,
    };
    await db.recurrences.put(rec);
    await db.installments.bulkPut(
      dates.map((due, i): Installment => ({
        id: crypto.randomUUID(),
        recurrence_id: rec.id,
        seq: i + 1,
        due_date: due,
        amount: fromCents(amounts[i]),
        mode: input.mode,
        client_modified_at: stamp,
        deleted_at: null,
      })),
    );
    await queueRec(db, rec.id);
    return rec;
  });
}

/** Cancella (logicamente) un movimento generato; resta come traccia per non rigenerarlo. */
async function dropTx(db: QuadraDB, tx: Transaction) {
  await db.transactions.put({ ...tx, deleted_at: now(), client_modified_at: now() });
  await queueTx(db, tx.id);
}

/** Termina una ricorrenza o un piano: la storia resta, le scadenze future spariscono. */
export async function endRecurrence(db: QuadraDB, id: string, today: string): Promise<void> {
  await db.transaction('rw', [db.recurrences, db.installments, db.transactions, db.outbox], async () => {
    const rec = await db.recurrences.get(id);
    if (!rec) return;
    await db.recurrences.put({ ...rec, active: false, end_date: rec.end_date && rec.end_date < today ? rec.end_date : today, client_modified_at: now() });
    const stamp = now();
    const future = await db.installments.where('recurrence_id').equals(id).filter((i) => !i.deleted_at && i.due_date > today).toArray();
    for (const i of future) await db.installments.put({ ...i, deleted_at: stamp, client_modified_at: stamp });
    const txs = await db.transactions.filter((t) => t.recurrence_id === id && !t.deleted_at && t.tx_date > today).toArray();
    for (const t of txs) await dropTx(db, t);
    await queueRec(db, id);
  });
}

/**
 * Dopo una modifica: le scadenze future già preparate si allineano
 * (importo, categoria, esercizio) oppure spariscono se la data non esiste più.
 * Quelle passate non si toccano mai.
 */
async function reconcileFuture(db: QuadraDB, rec: Recurrence, today: string, kindChanged = false): Promise<void> {
  const sched = scheduleOf(rec);
  const valid = new Set(sched ? occurrenceDates(sched, addDays(today, LOOKAHEAD_DAYS)) : []);
  await db.transaction('rw', [db.transactions, db.outbox], async () => {
    const future = await db.transactions.filter((t) => t.recurrence_id === rec.id && !t.deleted_at && t.tx_date > today).toArray();
    for (const tx of future) {
      if (!tx.occurrence_date || !valid.has(tx.occurrence_date)) {
        await dropTx(db, tx);
        continue;
      }
      const foreign = rec.currency !== 'EUR' && tx.fx_rate != null;
      // in valuta estera l'importo di riferimento è in valuta: il totale in euro segue il cambio già stimato
      const orig = foreign ? toCents(rec.reference_amount ?? tx.amount_original ?? 0) : 0;
      const cents = foreign ? convertCents(orig, tx.fx_rate!) : toCents(rec.reference_amount ?? tx.total);
      const sameLine = tx.lines[0];
      // se la ricorrenza passa da fissa a variabile (o viceversa) le scadenze future seguono il nuovo tipo
      const status = !kindChanged ? tx.status : rec.kind === 'variable' ? 'scheduled' : 'confirmed';
      if (status === tx.status && tx.total === fromCents(cents) && (!foreign || tx.amount_original === fromCents(orig)) && sameLine?.category_id === rec.category_id && tx.merchant_id === rec.merchant_id && tx.note === rec.note) continue;
      await db.transactions.put({
        ...tx,
        status,
        total: fromCents(cents),
        ...(foreign ? { amount_original: fromCents(orig) } : {}),
        merchant_id: rec.merchant_id,
        note: rec.note,
        lines: [{ category_id: rec.category_id, amount: fromCents(cents), flag_override: null }],
        client_modified_at: now(),
      });
      await queueTx(db, tx.id);
    }
  });
}

/**
 * Prepara i movimenti delle scadenze arrivate o in arrivo nei prossimi 30 giorni.
 * - fissa o rata automatica: movimento confermato (se la data è futura si mostra "programmato");
 * - variabile o rata da confermare: movimento "da confermare" con l'ultimo importo noto.
 * Una scadenza già generata, anche se poi cancellata, non si rigenera.
 * Restituisce quanti movimenti con data già passata (o di oggi) sono stati creati.
 */
export async function generateDue(db: QuadraDB, today: string): Promise<number> {
  const horizon = addDays(today, LOOKAHEAD_DAYS);
  const recs = (await db.recurrences.toArray()).filter((r) => r.active && !r.deleted_at);
  if (recs.length === 0) return 0;
  const txs = await db.transactions.toArray();
  const byRec = new Map<string, Transaction[]>();
  for (const t of txs) if (t.recurrence_id) byRec.set(t.recurrence_id, [...(byRec.get(t.recurrence_id) ?? []), t]);

  const created: Transaction[] = [];
  const updates: Transaction[] = [];

  for (const rec of recs) {
    const mine = byRec.get(rec.id) ?? [];
    const seen = new Set(mine.map((t) => t.occurrence_date));
    // ultimo importo confermato: stima per le variabili
    const lastConfirmed = [...mine]
      .filter((t) => !t.deleted_at && t.status === 'confirmed')
      .sort((a, b) => (b.occurrence_date ?? '').localeCompare(a.occurrence_date ?? ''))[0];
    const foreignRec = rec.currency !== 'EUR' && rec.kind !== 'plan';
    // in valuta estera la stima è nella valuta della ricorrenza
    const estimate = (foreignRec ? lastConfirmed?.amount_original : lastConfirmed?.total) ?? rec.reference_amount ?? 0;

    const due: { date: string; id: string; amount: number; confirmed: boolean }[] = [];
    if (rec.kind === 'plan') {
      const rows = await db.installments.where('recurrence_id').equals(rec.id).toArray();
      for (const i of rows) {
        if (i.deleted_at || i.due_date > horizon) continue;
        due.push({ date: i.due_date, id: await stableId('inst', i.id), amount: i.amount, confirmed: i.mode === 'auto' });
      }
    } else {
      const sched = scheduleOf(rec);
      if (!sched) continue;
      for (const date of occurrenceDates(sched, horizon)) {
        due.push({ date, id: await stableId('rec', rec.id, date), amount: estimate, confirmed: rec.kind === 'fixed' && !foreignRec });
      }
    }

    for (const d of due) {
      if (seen.has(d.date) || d.amount <= 0) continue;
      if (foreignRec) {
        // scadenza in valuta: nasce "da confermare", stimata al cambio del giorno (o all'ultimo noto); senza cambio si riprova alla prossima apertura
        const r = await getRate(db, rec.currency, d.date <= today ? d.date : today, today, 2500);
        if (!r) continue;
        const total = fromCents(convertCents(toCents(d.amount), r.rate));
        created.push({
          id: d.id, tx_kind: rec.tx_kind, total, tx_date: d.date, merchant_id: rec.merchant_id, note: rec.note,
          status: 'scheduled', accrual_mode: 'same', currency: rec.currency, amount_original: d.amount, fx_rate: r.rate, fx_status: 'estimated',
          recurrence_id: rec.id, occurrence_date: d.date, installment_id: null, client_modified_at: now(), deleted_at: null,
          lines: [{ category_id: rec.category_id, amount: total, flag_override: null }],
        });
        continue;
      }
      const inst = rec.kind === 'plan' ? (await db.installments.where('recurrence_id').equals(rec.id).toArray()).find((i) => i.due_date === d.date) : undefined;
      created.push({
        id: d.id,
        tx_kind: rec.tx_kind,
        total: d.amount,
        tx_date: d.date,
        merchant_id: rec.merchant_id,
        note: rec.note,
        status: d.confirmed ? 'confirmed' : 'scheduled',
        accrual_mode: 'same',
        fx_status: 'none',
        recurrence_id: rec.id,
        occurrence_date: d.date,
        installment_id: inst?.id ?? null,
        client_modified_at: now(),
        deleted_at: null,
        lines: [{ category_id: rec.category_id, amount: d.amount, flag_override: null }],
      });
    }

    // le variabili non ancora confermate seguono l'ultimo importo confermato
    if (rec.kind === 'variable') {
      for (const t of mine) {
        if (foreignRec && t.fx_rate && !t.deleted_at && t.status === 'scheduled' && t.amount_original !== estimate && estimate > 0) {
          const total = fromCents(convertCents(toCents(estimate), t.fx_rate));
          updates.push({ ...t, amount_original: estimate, total, lines: [{ ...t.lines[0], amount: total }], client_modified_at: now() });
        } else if (!foreignRec && !t.deleted_at && t.status === 'scheduled' && t.total !== estimate && estimate > 0) {
          updates.push({ ...t, total: estimate, lines: [{ ...t.lines[0], amount: estimate }], client_modified_at: now() });
        }
      }
    }
  }

  if (created.length === 0 && updates.length === 0) return 0;
  await db.transaction('rw', [db.transactions, db.outbox], async () => {
    for (const t of [...created, ...updates]) {
      // un'altra scadenza identica può essere arrivata dal server nel frattempo
      if (!updates.includes(t) && (await db.transactions.get(t.id))) continue;
      await db.transactions.put(t);
      await queueTx(db, t.id);
    }
  });
  return created.filter((t) => t.tx_date <= today).length;
}
