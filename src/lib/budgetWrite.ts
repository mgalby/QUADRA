import type { QuadraDB } from './db';
import type { Budget, BudgetLine, ReferenceBalance } from './types';

// Scrittura locale del budget. Come per le anagrafiche, ogni riga scritta entra
// nella coda di invio nella stessa transazione.

export async function writeBudget(
  db: QuadraDB,
  rows: { budgets?: Budget[]; lines?: BudgetLine[]; refs?: ReferenceBalance[] },
): Promise<void> {
  const stamp = new Date().toISOString();
  await db.transaction('rw', [db.budgets, db.budgetLines, db.refBalances, db.outbox], async () => {
    for (const b of rows.budgets ?? []) {
      await db.budgets.put({ ...b, client_modified_at: stamp, updated_at: stamp });
      await db.outbox.put({ key: `budget:${b.id}`, kind: 'budget', id: b.id });
    }
    for (const l of rows.lines ?? []) {
      await db.budgetLines.put({ ...l, client_modified_at: stamp, updated_at: stamp });
      await db.outbox.put({ key: `bline:${l.id}`, kind: 'bline', id: l.id });
    }
    for (const r of rows.refs ?? []) {
      await db.refBalances.put({ ...r, client_modified_at: stamp, updated_at: stamp });
      await db.outbox.put({ key: `refbal:${r.id}`, kind: 'refbal', id: r.id });
    }
  });
}
