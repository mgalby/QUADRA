import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { QuadraDB } from './db';
import { applyRestore, buildBackup, daysSince, parseBackup, planRestore } from './backup';
import type { Category, Macro, Merchant, Recurrence, Transaction } from './types';

const sync = { user_id: 'u1', updated_at: '2026-11-01T00:00:00Z', client_modified_at: '2026-11-01T00:00:00Z', deleted_at: null };
const macro: Macro = { ...sync, id: 'm1', tx_kind: 'expense', name: 'Casa', icon: 'house', color: '#3987e5', sort_order: 1, archived: false };
const cat = (id: string, name: string): Category => ({ ...sync, id, macro_id: 'm1', name, icon: 'tag', shade: null, flag: 'essential', pinned_slot: null, sort_order: 1, archived: false });
const mer: Merchant = { id: 'x1', name: 'Coop', merged_into_id: null, client_modified_at: '2026-11-01T00:00:00Z', deleted_at: null };
const tx = (id: string, extra: Partial<Transaction> = {}): Transaction => ({
  id, tx_kind: 'expense', total: 3000, tx_date: '2026-11-10', merchant_id: 'x1', note: null, status: 'confirmed', accrual_mode: 'same',
  fx_status: 'none', recurrence_id: null, occurrence_date: null, installment_id: null, client_modified_at: '2026-11-10T10:00:00Z', deleted_at: null,
  lines: [{ category_id: 'c1', amount: 2000, flag_override: null }, { category_id: 'c2', amount: 1000, flag_override: 'discretionary' }], ...extra,
});
const rec: Recurrence = {
  id: 'r1', name: 'Rata', kind: 'plan', tx_kind: 'expense', category_id: 'c1', merchant_id: null, note: null, reference_amount: null, currency: 'EUR',
  interval_n: null, interval_unit: null, anchor: null, anchor_day: null, start_date: null, end_date: null, max_occurrences: null,
  notify_days_before: 1, active: true, client_modified_at: '2026-11-01T00:00:00Z', deleted_at: null,
};

let n = 0;
let db: QuadraDB;
async function seed(d: QuadraDB) {
  await d.profile.put({ id: 'u1', display_name: 'Marco', role: 'admin', locale: 'it', theme: 'dark', base_currency: 'EUR', updated_at: '' });
  await d.macros.put(macro);
  await d.categories.bulkPut([cat('c1', 'Bollette'), cat('c2', 'Cene')]);
  await d.merchants.put(mer);
  await d.transactions.bulkPut([tx('t1'), tx('t2', { total: 500, lines: [{ category_id: 'c1', amount: 500, flag_override: null }] })]);
  await d.recurrences.put(rec);
  await d.installments.put({ id: 'i1', recurrence_id: 'r1', seq: 1, due_date: '2026-12-01', amount: 100, mode: 'auto', client_modified_at: '2026-11-01T00:00:00Z', deleted_at: null });
  await d.meta.bulkPut([
    { key: 'pref:trips', value: '[{"id":"v1"}]' }, { key: 'import:2026', value: '{}' },
    { key: 'last_sync', value: 'x' }, { key: 'fx:USD:last', value: '1.1' }, { key: 'grid:expense', value: '{}' },
  ]);
}

beforeEach(() => { db = new QuadraDB(`test-${n++}`); });

describe('backup', () => {
  it('il file contiene tutto e solo le preferenze', async () => {
    await seed(db);
    const b = await buildBackup(db, 'u1', '0.9.1');
    expect(b.transactions).toHaveLength(2);
    expect(b.transactions[0].lines).toHaveLength(2);
    expect(b.installments).toHaveLength(1);
    expect(b.meta.map((m) => m.key).sort()).toEqual(['import:2026', 'pref:trips']);
  });

  it('include le righe cancellate logicamente', async () => {
    await seed(db);
    await db.transactions.update('t2', { deleted_at: '2026-11-11T00:00:00Z' });
    expect((await buildBackup(db, 'u1', 'x')).transactions.find((x) => x.id === 't2')?.deleted_at).toBeTruthy();
  });

  it('parse: rifiuta file estranei, di altro utente, più nuovi o con riferimenti rotti', async () => {
    await seed(db);
    const text = JSON.stringify(await buildBackup(db, 'u1', 'x'));
    expect(parseBackup(text, 'u1').ok).toBe(true);
    expect(parseBackup('non json', 'u1')).toEqual({ ok: false, reason: 'format' });
    expect(parseBackup('{"app":"altro","format":1}', 'u1')).toEqual({ ok: false, reason: 'format' });
    expect(parseBackup(text, 'u2')).toEqual({ ok: false, reason: 'user' });
    expect(parseBackup(JSON.stringify({ ...JSON.parse(text), format: 99 }), 'u1')).toEqual({ ok: false, reason: 'newer' });
    expect(parseBackup(JSON.stringify({ ...JSON.parse(text), macros: undefined }), 'u1')).toEqual({ ok: false, reason: 'broken' });
    const broken = JSON.parse(text);
    broken.categories = broken.categories.filter((c: Category) => c.id !== 'c2');
    expect(parseBackup(JSON.stringify(broken), 'u1')).toEqual({ ok: false, reason: 'refs' });
    // …ma se la categoria c'è già sul dispositivo il riferimento regge
    expect(parseBackup(JSON.stringify(broken), 'u1', { categories: new Set(['c2']), merchants: new Set() }).ok).toBe(true);
  });

  it('ripristino su dispositivo vuoto: tutto in scrittura e in coda di invio', async () => {
    await seed(db);
    const file = await buildBackup(db, 'u1', 'x');
    const empty = new QuadraDB(`test-${n++}`);
    const plan = await planRestore(empty, file);
    expect(plan.transactions).toEqual({ added: 2, changed: 0, same: 0 });
    expect(plan.toWrite).toBe(1 + 2 + 1 + 2 + 1 + 1);
    await applyRestore(empty, file);
    expect(await empty.transactions.count()).toBe(2);
    expect((await empty.transactions.get('t1'))?.lines).toHaveLength(2);
    expect(await empty.installments.count()).toBe(1);
    const keys = (await empty.outbox.toArray()).map((o) => o.key).sort();
    expect(keys).toEqual(['cat:c1', 'cat:c2', 'macro:m1', 'merchant:x1', 'rec:r1', 'tx:t1', 'tx:t2']);
    expect((await empty.meta.get('pref:trips'))?.value).toBe('[{"id":"v1"}]');
    expect((await empty.transactions.get('t1'))!.client_modified_at > '2026-11-10T10:00:00Z').toBe(true);
  });

  it('ripristino sullo stesso dispositivo: annulla una cancellazione e una modifica, lascia le righe nuove', async () => {
    await seed(db);
    const file = await buildBackup(db, 'u1', 'x');
    await db.categories.update('c2', { deleted_at: '2026-11-12T00:00:00Z', name: 'Cenette' });
    await db.transactions.update('t1', { total: 9999 });
    await db.transactions.put(tx('t3'));            // nata dopo il backup
    const plan = await planRestore(db, file);
    expect(plan.categories).toEqual({ added: 0, changed: 1, same: 1 });
    expect(plan.transactions).toEqual({ added: 0, changed: 1, same: 1 });
    expect(plan.extra).toBe(1);
    expect(plan.toWrite).toBe(2);
    await applyRestore(db, file);
    expect((await db.categories.get('c2'))?.deleted_at).toBeNull();
    expect((await db.categories.get('c2'))?.name).toBe('Cene');
    expect((await db.transactions.get('t1'))?.total).toBe(3000);
    expect(await db.transactions.get('t3')).toBeTruthy();
    expect((await db.outbox.toArray()).map((o) => o.key).sort()).toEqual(['cat:c2', 'tx:t1']);
  });

  it('un secondo ripristino dello stesso file non cambia nulla', async () => {
    await seed(db);
    const file = await buildBackup(db, 'u1', 'x');
    const empty = new QuadraDB(`test-${n++}`);
    await applyRestore(empty, file);
    const again = await planRestore(empty, file);
    expect(again.toWrite).toBe(0);
  });

  it('daysSince', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    expect(daysSince(undefined, now)).toBeNull();
    expect(daysSince('2026-11-17T01:00:00Z', now)).toBe(0);
    expect(daysSince('2026-11-10T01:00:00Z', now)).toBe(7);
  });
});
