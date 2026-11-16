import type { QuadraDB } from './db';
import type { Category, Macro, Merchant } from './types';

// Scrittura locale delle anagrafiche. Come per i movimenti, ogni riga scritta
// entra nella coda di invio nella stessa transazione.

const now = () => new Date().toISOString();

/**
 * Salva macro e categorie modificate (o nuove). La griglia dell'inserimento si
 * ricalcola alla prossima apertura: una categoria nuova, fissata o archiviata
 * deve comparire o sparire subito.
 */
export async function writeMaster(db: QuadraDB, rows: { macros?: Macro[]; categories?: Category[] }): Promise<void> {
  const stamp = now();
  await db.transaction('rw', [db.macros, db.categories, db.outbox, db.meta], async () => {
    for (const m of rows.macros ?? []) {
      await db.macros.put({ ...m, client_modified_at: stamp, updated_at: stamp });
      await db.outbox.put({ key: `macro:${m.id}`, kind: 'macro', id: m.id });
    }
    for (const c of rows.categories ?? []) {
      await db.categories.put({ ...c, client_modified_at: stamp, updated_at: stamp });
      await db.outbox.put({ key: `cat:${c.id}`, kind: 'cat', id: c.id });
    }
    await db.meta.bulkDelete(['grid:expense', 'grid:income']);
  });
}

/** Salva gli esercizi modificati (rinomina, fusione, separazione, eliminazione). */
export async function writeMerchants(db: QuadraDB, merchants: Merchant[]): Promise<void> {
  const stamp = now();
  await db.transaction('rw', [db.merchants, db.outbox], async () => {
    for (const m of merchants) {
      await db.merchants.put({ id: m.id, name: m.name, merged_into_id: m.merged_into_id, client_modified_at: stamp, deleted_at: m.deleted_at });
      await db.outbox.put({ key: `merchant:${m.id}`, kind: 'merchant', id: m.id });
    }
  });
}

/** Riga nuova con i campi di servizio già compilati. */
export function blankSync(userId: string): { id: string; user_id: string; updated_at: string; client_modified_at: string; deleted_at: null } {
  const stamp = now();
  return { id: crypto.randomUUID(), user_id: userId, updated_at: stamp, client_modified_at: stamp, deleted_at: null };
}
