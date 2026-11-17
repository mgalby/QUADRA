import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { actualsOf, programmedItems, refreshDraft, sumByCategory, type Actuals, type ProgrammedItem } from './budget';
import { writeBudget } from './budgetWrite';
import type { QuadraDB } from './db';
import type { Budget, BudgetLine, ReferenceBalance } from './types';

export interface BudgetData {
  ready: boolean;
  budget: Budget | null;
  lines: BudgetLine[];            // senza le cancellate
  allLines: BudgetLine[];         // anche cancellate (per riattivare un tetto dedicato)
  refs: ReferenceBalance[];       // senza le cancellate
  items: ProgrammedItem[];
  programmed: Map<string, number>;
  actuals: Actuals;
  years: number[];                // anni che hanno un budget
}

/** Ultimi cambi noti, salvati dalla valuta estera: servono a stimare le ricorrenze in valuta. */
async function lastRates(db: QuadraDB): Promise<Map<string, number>> {
  const rows = await db.meta.where('key').startsWith('fx:').toArray();
  return new Map(rows.filter((r) => r.key.endsWith(':last')).map((r) => [r.key.slice(3, 6), Number(r.value)]));
}

/** Tutto ciò che serve alle schermate del Budget per un anno, aggiornato da solo. */
export function useBudgetData(db: QuadraDB, year: number, today: string, categories: Parameters<typeof refreshDraft>[1], onSync?: () => void): BudgetData {
  const budgets = useLiveQuery(() => db.budgets.toArray(), [db]);
  const budget = (budgets ?? []).find((b) => b.year === year && !b.deleted_at) ?? null;
  const allLines = useLiveQuery(() => (budget ? db.budgetLines.where('budget_id').equals(budget.id).toArray() : []), [db, budget?.id]);
  const refs = useLiveQuery(() => db.refBalances.toArray(), [db]);
  const txs = useLiveQuery(() => db.transactions.toArray(), [db]);
  const recs = useLiveQuery(() => db.recurrences.toArray(), [db]);
  const installments = useLiveQuery(() => db.installments.toArray(), [db]);
  const rates = useLiveQuery(() => lastRates(db), [db]);

  const ready = [budgets, allLines, refs, txs, recs, installments, rates].every((x) => x !== undefined);
  const items = useMemo(
    () => (ready ? programmedItems({ year, recs: recs!, installments: installments!, txs: txs!, rates: rates! }) : []),
    [ready, year, recs, installments, txs, rates],
  );
  const programmed = useMemo(() => sumByCategory(items), [items]);
  const actuals = useMemo(() => actualsOf(txs ?? [], year, today, items), [txs, year, today, items]);
  const lines = useMemo(() => (allLines ?? []).filter((l) => !l.deleted_at), [allLines]);
  const liveRefs = useMemo(() => (refs ?? []).filter((r) => !r.deleted_at), [refs]);

  // bozza viva: programmato e proposte delle voci non toccate seguono ricorrenze e storico
  useEffect(() => {
    if (!ready || !budget || budget.status !== 'draft' || categories.size === 0) return;
    const changed = refreshDraft(lines, categories, liveRefs, programmed, year);
    if (changed.length > 0) void writeBudget(db, { lines: changed }).then(() => onSync?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, budget, lines, categories, liveRefs, programmed, year, db]);

  return {
    ready, budget, lines, allLines: allLines ?? [], refs: liveRefs, items, programmed, actuals,
    years: [...new Set((budgets ?? []).filter((b) => !b.deleted_at).map((b) => b.year))].sort(),
  };
}
