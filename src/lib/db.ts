import Dexie, { type EntityTable } from 'dexie';
import type { Budget, BudgetLine, Category, Installment, Macro, Merchant, OutboxEntry, Profile, Recurrence, ReferenceBalance, Transaction } from './types';

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
  transactions!: EntityTable<Transaction, 'id'>;
  merchants!: EntityTable<Merchant, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'key'>;
  recurrences!: EntityTable<Recurrence, 'id'>;
  installments!: EntityTable<Installment, 'id'>;
  budgets!: EntityTable<Budget, 'id'>;
  budgetLines!: EntityTable<BudgetLine, 'id'>;
  refBalances!: EntityTable<ReferenceBalance, 'id'>;

  constructor(userId: string) {
    super(`quadra-${userId}`);
    // Quando si aggiungono tabelle o indici: nuova version(n), mai modificare le precedenti.
    this.version(1).stores({
      profile: 'id',
      macros: 'id, tx_kind, sort_order',
      categories: 'id, macro_id, sort_order',
      meta: 'key',
    });
    this.version(2).stores({
      transactions: 'id, tx_date, merchant_id',
      merchants: 'id',
      outbox: 'key',
    });
    this.version(3).stores({
      recurrences: 'id',
      installments: 'id, recurrence_id, due_date',
    });
    // v1.1 Budget
    this.version(4).stores({
      budgets: 'id, year',
      budgetLines: 'id, budget_id',
      refBalances: 'id, year',
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
