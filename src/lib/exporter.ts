// Esportazione in CSV con lo stesso tracciato dell'importazione: il file si
// reimporta così com'è. Logica pura, senza schermo né database.
import { accrualsOf, paymentsOf } from './basis';
import { csvCell } from './csv';
import { toCents } from './money';
import type { Transaction } from './types';

export const EXPORT_HEADER = ['Data', 'Importo', 'Segno', 'Categoria', 'Esercizio', 'Note', 'Competenza', 'Valuta', 'ImportoOriginale'];

export interface ExportResult {
  text: string;        // contenuto del file, con BOM e separatore ";"
  rows: number;        // righe scritte
  movements: number;   // movimenti esportati
  split: number;       // scontrini divisi: una riga per categoria
  lostPlans: number;   // movimenti spalmati o con più pagamenti: il piano non entra nel tracciato
}

const amount = (cents: number) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Movimenti confermati con data nell'intervallo (estremi compresi), dal più vecchio. */
export function exportable(txs: Transaction[], from: string, to: string): Transaction[] {
  return txs
    .filter((tx) => !tx.deleted_at && tx.status === 'confirmed' && tx.tx_date >= from && tx.tx_date <= to)
    .sort((a, b) => a.tx_date.localeCompare(b.tx_date) || a.client_modified_at.localeCompare(b.client_modified_at) || a.id.localeCompare(b.id));
}

export function buildExport(
  txs: Transaction[],
  from: string,
  to: string,
  categoryName: (id: string) => string,
  merchantName: (id: string) => string,
  baseCurrency: string,
): ExportResult {
  const list = exportable(txs, from, to);
  const out: string[][] = [EXPORT_HEADER];
  let split = 0;
  let lostPlans = 0;
  for (const tx of list) {
    const accruals = accrualsOf(tx);
    if (accruals.length > 1 || paymentsOf(tx).length > 1) lostPlans++;
    if (tx.lines.length > 1) split++;
    // competenza: solo se diversa dal mese del pagamento; di una spesa spalmata resta il primo mese
    const month = accruals[0].period.slice(0, 7);
    const competenza = month === tx.tx_date.slice(0, 7) ? '' : month;
    const foreign = !!tx.currency && tx.currency !== baseCurrency && !!tx.amount_original;
    // l'importo in valuta estera si ripartisce tra le righe come il totale
    const originals: number[] = [];
    if (foreign) {
      const total = toCents(tx.total);
      const orig = toCents(tx.amount_original!);
      let used = 0;
      tx.lines.forEach((l, i) => {
        const v = i === tx.lines.length - 1 ? orig - used : total === 0 ? 0 : Math.round((toCents(l.amount) * orig) / total);
        used += v;
        originals.push(v);
      });
    }
    tx.lines.forEach((l, i) => {
      out.push([
        day(tx.tx_date),
        amount(toCents(l.amount)),
        tx.tx_kind === 'income' ? 'E' : 'U',
        categoryName(l.category_id),
        tx.merchant_id ? merchantName(tx.merchant_id) : '',
        tx.note ?? '',
        competenza,
        foreign ? tx.currency! : '',
        foreign ? amount(originals[i]) : '',
      ]);
    });
  }
  const text = `﻿${out.map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
  return { text, rows: out.length - 1, movements: list.length, split, lostPlans };
}
