import Dexie, { type EntityTable } from 'dexie';
import type { Category, Macro, Profile } from './types';

/** Coppie chiave/valore locali: es. data dell'ultima sincronizzazione. */
export interface Meta {
  key: string;
  value: string;
}

// Archivio locale (IndexedDB): l'app legge e scrive sempre qui, poi sincronizza.
// Un database per utente, così due account sullo stesso dispositivo non si mescolano.
export class QuadraDB extends Dexie {
  profile!: EntityTable<Profile, 'id'>;
  macros!: EntityTable<Macro, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  meta!: EntityTable<Meta, 'key'>;

  constructor(userId: string) {
    super(`quadra-${userId}`);
    // Quando si aggiungono tabelle o indici: nuova version(n), mai modificare questa.
    this.version(1).stores({
      profile: 'id',
      macros: 'id, tx_kind, sort_order',
      categories: 'id, macro_id, sort_order',
      meta: 'key',
    });
  }
}

let current: QuadraDB | null = null;

export function openDb(userId: string): QuadraDB {
  if (current?.name !== `quadra-${userId}`) {
    current?.close();
    current = new QuadraDB(userId);
  }
  return current;
}
