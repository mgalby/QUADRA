// Importazione da CSV: scrittura dei movimenti e annullo in blocco.
import { normalizeName, type ImportItem, type PreviewContext } from './csv';
import type { QuadraDB } from './db';
import { deleteTransaction, merchantStats, saveTransaction } from './data';
import { FX_CURRENCIES } from './fx';
import type { Plan } from './plan';
import type { Category, Macro, TxKind } from './types';

const KEY = 'import:';

export interface ImportBatch {
  key: string;
  at: string;
  file: string;
  ids: string[];
}

/** Categorie utilizzabili, con il tipo (uscita/entrata) preso dalla macro. */
export function categoryInfos(categories: Category[], macroById: Map<string, Macro>): PreviewContext['categories'] {
  return categories.flatMap((c) => {
    const kind = macroById.get(c.macro_id)?.tx_kind;
    return kind ? [{ id: c.id, name: c.name, kind }] : [];
  });
}

/** Categoria abituale per esercizio, dalla storia già presente. */
export async function merchantTopMap(db: QuadraDB): Promise<PreviewContext['merchantTop']> {
  const out: PreviewContext['merchantTop'] = new Map();
  for (const s of await merchantStats(db)) {
    const top: Partial<Record<TxKind, string>> = {};
    if (s.topCategory.expense) top.expense = s.topCategory.expense;
    if (s.topCategory.income) top.income = s.topCategory.income;
    out.set(normalizeName(s.merchant.name), top);
  }
  return out;
}

export async function existingTxs(db: QuadraDB): Promise<PreviewContext['existing']> {
  return (await db.transactions.toArray())
    .filter((t) => !t.deleted_at)
    .map((t) => ({ date: t.tx_date, kind: t.tx_kind, cents: Math.round(t.total * 100) }));
}

/** Scrive i movimenti scelti, uno alla volta, e ricorda l'importazione per poterla annullare. */
export async function runImport(
  db: QuadraDB, items: ImportItem[], file: string, baseCurrency: string, onProgress?: (done: number) => void,
): Promise<ImportBatch> {
  const ids: string[] = [];
  let done = 0;
  for (const it of items) {
    if (!it.categoryId || !it.row.date) continue;
    const month = it.row.month;
    const plan: Plan | undefined = month && month !== it.row.date.slice(0, 7)
      ? { acc: [{ month, cents: it.cents }], pay: null }
      : undefined;
    const cur = it.row.currency;
    const fx = cur && cur !== baseCurrency && it.row.original && (FX_CURRENCIES as readonly string[]).includes(cur)
      ? { currency: cur, original: it.row.original, rate: 1, status: 'final' as const }
      : undefined;
    const tx = await saveTransaction(db, {
      kind: it.kind,
      cents: it.cents,
      date: it.row.date,
      merchantName: it.row.merchant,
      note: it.row.note,
      categoryId: it.categoryId,
      plan,
      fx,
    });
    ids.push(tx.id);
    if (++done % 25 === 0) onProgress?.(done);
  }
  onProgress?.(done);
  const at = new Date().toISOString();
  const batch: ImportBatch = { key: `${KEY}${at}`, at, file, ids };
  await db.meta.put({ key: batch.key, value: JSON.stringify({ at, file, ids }) });
  return batch;
}

export async function loadImports(db: QuadraDB): Promise<ImportBatch[]> {
  const rows = await db.meta.where('key').startsWith(KEY).toArray();
  return rows
    .map((r) => ({ key: r.key, ...(JSON.parse(r.value) as Omit<ImportBatch, 'key'>) }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Cancella (logicamente) tutti i movimenti dell'importazione ancora presenti. */
export async function undoImport(db: QuadraDB, batch: ImportBatch): Promise<number> {
  let n = 0;
  for (const id of batch.ids) {
    const tx = await db.transactions.get(id);
    if (tx && !tx.deleted_at) { await deleteTransaction(db, id); n++; }
  }
  await db.meta.delete(batch.key);
  return n;
}
