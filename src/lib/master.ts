import { shades } from './colors';
import type { Category, Flag, Macro, Merchant, Recurrence, Transaction, TxKind } from './types';

// Regole delle anagrafiche (macro, categorie, esercizi): funzioni pure, senza
// accesso ai dati. Le schermate le usano per decidere cosa è permesso e
// calcolano qui le righe da scrivere; la scrittura sta in masterWrite.ts.

export const cleanName = (s: string) => s.trim().replace(/\s+/g, ' ');
const fold = (s: string) => cleanName(s).toLowerCase();
export const NAME_MAX = 40;

/** Colori proposti per le macro: tarati sullo sfondo scuro, distinguibili tra loro. */
export const MACRO_COLORS = [
  '#3987e5', '#199e70', '#d95926', '#c98500', '#0ca30c', '#9085e9',
  '#d55181', '#e66767', '#8B93A0', '#17a2b8', '#c06bd0', '#7a9a2e',
] as const;

/** Le quattro sfumature tra cui scegliere il colore di una categoria. */
export const shadeChoices = (macroColor: string) => shades(macroColor, 4);

// ----- stato --------------------------------------------------------------

export const macroActive = (m: Macro | undefined) => !!m && !m.deleted_at && !m.archived;
/** Una categoria è attiva se lo è lei e lo è la sua macro. */
export const categoryActive = (c: Category, macroById: Map<string, Macro>) =>
  !c.deleted_at && !c.archived && macroActive(macroById.get(c.macro_id));
export const kindOfCategory = (c: Category, macroById: Map<string, Macro>): TxKind | undefined => macroById.get(c.macro_id)?.tx_kind;

/** Tipo di spesa di una macro, dalle sue categorie attive: tutte uguali oppure "mista". */
export function macroFlag(cats: Category[]): Flag | 'mixed' | null {
  const flags = new Set(cats.map((c) => c.flag));
  return flags.size === 0 ? null : flags.size === 1 ? [...flags][0] : 'mixed';
}

// ----- nomi ---------------------------------------------------------------

export type NameProblem = 'empty' | 'long' | 'duplicate';

/**
 * Due categorie attive dello stesso tipo (uscita/entrata) non possono avere lo
 * stesso nome: l'importazione CSV le riconosce dal nome.
 */
export function categoryNameProblem(
  name: string, kind: TxKind, selfId: string | null, categories: Category[], macroById: Map<string, Macro>,
): NameProblem | null {
  const n = fold(name);
  if (n === '') return 'empty';
  if (cleanName(name).length > NAME_MAX) return 'long';
  const clash = categories.some(
    (c) => c.id !== selfId && categoryActive(c, macroById) && kindOfCategory(c, macroById) === kind && fold(c.name) === n,
  );
  return clash ? 'duplicate' : null;
}

export function macroNameProblem(name: string, kind: TxKind, selfId: string | null, macros: Macro[]): NameProblem | null {
  const n = fold(name);
  if (n === '') return 'empty';
  if (cleanName(name).length > NAME_MAX) return 'long';
  return macros.some((m) => m.id !== selfId && macroActive(m) && m.tx_kind === kind && fold(m.name) === n) ? 'duplicate' : null;
}

// ----- uso ----------------------------------------------------------------

export interface CategoryUsage {
  movements: number;          // movimenti (non cancellati) con almeno una riga sulla categoria
  followFlag: number;         // di questi, quanti seguono il tipo di spesa della categoria (nessun override sulla riga)
  activeRecurrences: string[]; // nomi delle ricorrenze attive che la usano
  recurrences: number;        // ricorrenze non cancellate, attive o terminate
}

export function categoryUsage(categoryId: string, txs: Transaction[], recs: Recurrence[]): CategoryUsage {
  let movements = 0;
  let followFlag = 0;
  for (const tx of txs) {
    if (tx.deleted_at) continue;
    const lines = tx.lines.filter((l) => l.category_id === categoryId);
    if (lines.length === 0) continue;
    movements++;
    if (lines.some((l) => l.flag_override === null)) followFlag++;
  }
  const live = recs.filter((r) => !r.deleted_at && r.category_id === categoryId);
  return { movements, followFlag, activeRecurrences: live.filter((r) => r.active).map((r) => r.name), recurrences: live.length };
}

/** Si elimina solo ciò che non ha storia; il resto si archivia. */
export const canDeleteCategory = (u: CategoryUsage) => u.movements === 0 && u.recurrences === 0;
/** Una ricorrenza attiva continuerebbe a generare scadenze sulla categoria archiviata. */
export const canArchiveCategory = (u: CategoryUsage) => u.activeRecurrences.length === 0;

export interface MacroUsage {
  categories: number;          // categorie non eliminate, anche archiviate
  activeCategories: number;
  activeRecurrences: string[]; // ricorrenze attive sulle sue categorie attive
  lastOfKind: boolean;         // è l'unica macro attiva del suo tipo
}

export function macroUsage(macro: Macro, macros: Macro[], categories: Category[], recs: Recurrence[]): MacroUsage {
  const own = categories.filter((c) => c.macro_id === macro.id && !c.deleted_at);
  const active = own.filter((c) => !c.archived);
  const ids = new Set(active.map((c) => c.id));
  return {
    categories: own.length,
    activeCategories: active.length,
    activeRecurrences: recs.filter((r) => !r.deleted_at && r.active && ids.has(r.category_id)).map((r) => r.name),
    lastOfKind: !macros.some((m) => m.id !== macro.id && macroActive(m) && m.tx_kind === macro.tx_kind),
  };
}

export const canDeleteMacro = (u: MacroUsage) => u.categories === 0 && !u.lastOfKind;
export const canArchiveMacro = (u: MacroUsage) => u.activeRecurrences.length === 0 && !u.lastOfKind;

// ----- ordine e griglia ---------------------------------------------------

/** Posizione successiva all'ultima, per una riga nuova. */
export const nextSortOrder = (rows: { sort_order: number }[]) => rows.reduce((max, r) => Math.max(max, r.sort_order), 0) + 1;

/**
 * Sposta una riga di un posto in su o in giù nell'elenco (già ordinato) e
 * restituisce solo le righe la cui posizione è cambiata, rinumerate da 1.
 */
export function moveRow<T extends { id: string; sort_order: number }>(ordered: T[], id: string, dir: -1 | 1): T[] {
  const i = ordered.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= ordered.length) return [];
  const next = [...ordered];
  [next[i], next[j]] = [next[j], next[i]];
  return next.flatMap((r, k) => (r.sort_order === k + 1 ? [] : [{ ...r, sort_order: k + 1 }]));
}

export const GRID_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Chi occupa oggi una casella della griglia, tra le categorie attive dello stesso tipo. */
export function slotOwner(
  slot: number, kind: TxKind, selfId: string | null, categories: Category[], macroById: Map<string, Macro>,
): Category | undefined {
  return categories.find(
    (c) => c.id !== selfId && c.pinned_slot === slot && categoryActive(c, macroById) && kindOfCategory(c, macroById) === kind,
  );
}

// ----- esercizi -----------------------------------------------------------

/** Id dell'esercizio principale: un doppione unito rimanda a quello in cui è confluito. */
export function mainMerchantId(id: string, byId: Map<string, Merchant>): string {
  let cur = byId.get(id);
  // la catena è lunga al più un passo, ma un ciclo non deve bloccare l'app
  for (let hop = 0; cur?.merged_into_id && hop < 5; hop++) {
    const next = byId.get(cur.merged_into_id);
    if (!next || next.deleted_at) break;
    cur = next;
  }
  return cur?.id ?? id;
}

/** Nome da mostrare per ogni esercizio: i doppioni uniti prendono il nome del principale. */
export function merchantNameMap(merchants: Merchant[]): Map<string, string> {
  const byId = new Map(merchants.map((m) => [m.id, m]));
  return new Map(merchants.map((m) => [m.id, byId.get(mainMerchantId(m.id, byId))?.name ?? m.name]));
}

export interface MerchantRow {
  merchant: Merchant;
  aliases: Merchant[];   // doppioni uniti a questo
  movements: number;     // suoi e dei doppioni
  recurrences: number;
}

/** Elenco degli esercizi principali, in ordine alfabetico, con doppioni e utilizzi. */
export function merchantRows(merchants: Merchant[], txs: Transaction[], recs: Recurrence[]): MerchantRow[] {
  const live = merchants.filter((m) => !m.deleted_at);
  const byId = new Map(live.map((m) => [m.id, m]));
  const rows = new Map<string, MerchantRow>();
  for (const m of live) if (mainMerchantId(m.id, byId) === m.id) rows.set(m.id, { merchant: m, aliases: [], movements: 0, recurrences: 0 });
  for (const m of live) {
    const main = mainMerchantId(m.id, byId);
    if (main !== m.id) rows.get(main)?.aliases.push(m);
  }
  for (const tx of txs) {
    if (tx.deleted_at || !tx.merchant_id) continue;
    const row = rows.get(mainMerchantId(tx.merchant_id, byId));
    if (row) row.movements++;
  }
  for (const r of recs) {
    if (r.deleted_at || !r.merchant_id) continue;
    const row = rows.get(mainMerchantId(r.merchant_id, byId));
    if (row) row.recurrences++;
  }
  return [...rows.values()].sort((a, b) => a.merchant.name.localeCompare(b.merchant.name, undefined, { sensitivity: 'base' }));
}

export type RenameCheck =
  | { ok: true; name: string }
  | { ok: false; problem: 'empty' | 'long' | 'same' }
  | { ok: false; problem: 'alias' }                    // il nome è di un doppione già unito a questo esercizio
  | { ok: false; problem: 'exists'; other: Merchant }; // esiste un altro esercizio (il principale): si può unire

/** Il nome di un esercizio è unico (maiuscole ignorate) tra tutti quelli non eliminati, doppioni compresi. */
export function checkMerchantRename(name: string, self: Merchant, merchants: Merchant[]): RenameCheck {
  const clean = cleanName(name);
  if (clean === '') return { ok: false, problem: 'empty' };
  if (clean.length > 80) return { ok: false, problem: 'long' };
  if (clean === self.name) return { ok: false, problem: 'same' };
  const live = merchants.filter((m) => !m.deleted_at);
  const byId = new Map(live.map((m) => [m.id, m]));
  const clash = live.find((m) => m.id !== self.id && fold(m.name) === fold(clean));
  if (!clash) return { ok: true, name: clean };
  const main = byId.get(mainMerchantId(clash.id, byId)) ?? clash;
  return main.id === self.id ? { ok: false, problem: 'alias' } : { ok: false, problem: 'exists', other: main };
}

/**
 * Unisce `source` a `target`: source e i suoi doppioni diventano doppioni di
 * target. I movimenti non si toccano. Restituisce le righe cambiate.
 */
export function mergeMerchants(sourceId: string, targetId: string, merchants: Merchant[]): Merchant[] {
  const byId = new Map(merchants.filter((m) => !m.deleted_at).map((m) => [m.id, m]));
  const target = mainMerchantId(targetId, byId);
  const source = mainMerchantId(sourceId, byId);
  if (source === target || !byId.has(source) || !byId.has(target)) return [];
  return [...byId.values()]
    .filter((m) => m.id === source || mainMerchantId(m.id, byId) === source)
    .map((m) => ({ ...m, merged_into_id: target }));
}

/** Un esercizio si elimina solo se non ha movimenti, ricorrenze né doppioni. */
export const canDeleteMerchant = (row: MerchantRow) => row.movements === 0 && row.recurrences === 0 && row.aliases.length === 0;
