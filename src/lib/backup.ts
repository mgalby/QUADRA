// Backup completo e ripristino. Il file contiene tutte le tabelle dell'utente
// (anche le righe cancellate logicamente, così un ripristino può annullare una
// cancellazione) più le preferenze del dispositivo (viaggi, vista, periodo).
// Il CSV non è un backup: perde divisione dello scontrino, piani e anagrafiche.
import type { QuadraDB } from './db';
import type { Budget, BudgetLine, Category, Installment, Macro, Merchant, Profile, Recurrence, ReferenceBalance, Transaction } from './types';

export const BACKUP_FORMAT = 1;
export const LAST_BACKUP_KEY = 'pref:last_backup';
/** Preferenze e dati solo-dispositivo che entrano nel file (viaggi, vista, importazioni…). */
const META_PREFIXES = ['pref:', 'import:'];
/** …tranne queste, che riguardano il backup stesso. */
const META_SKIP = new Set([LAST_BACKUP_KEY]);

export interface BackupFile {
  app: 'quadra';
  format: number;
  version: string;
  createdAt: string;
  userId: string;
  profile: Profile | null;
  macros: Macro[];
  categories: Category[];
  merchants: Merchant[];
  transactions: Transaction[];
  recurrences: Recurrence[];
  installments: Installment[];
  /** Dalla v1.1: nei file più vecchi mancano e valgono come elenchi vuoti. */
  budgets?: Budget[];
  budgetLines?: BudgetLine[];
  refBalances?: ReferenceBalance[];
  meta: { key: string; value: string }[];
}

export async function buildBackup(db: QuadraDB, userId: string, version: string): Promise<BackupFile> {
  const [profile, macros, categories, merchants, transactions, recurrences, installments, meta, budgets, budgetLines, refBalances] = await Promise.all([
    db.profile.get(userId),
    db.macros.toArray(),
    db.categories.toArray(),
    db.merchants.toArray(),
    db.transactions.toArray(),
    db.recurrences.toArray(),
    db.installments.toArray(),
    db.meta.toArray(),
    db.budgets.toArray(),
    db.budgetLines.toArray(),
    db.refBalances.toArray(),
  ]);
  return {
    app: 'quadra',
    format: BACKUP_FORMAT,
    version,
    createdAt: new Date().toISOString(),
    userId,
    profile: profile ?? null,
    macros,
    categories,
    merchants,
    transactions,
    recurrences,
    installments,
    budgets,
    budgetLines,
    refBalances,
    meta: meta.filter((m) => META_PREFIXES.some((p) => m.key.startsWith(p)) && !META_SKIP.has(m.key)),
  };
}

export const backupFileName = (day: string) => `quadra-backup-${day}.json`;

// ----- lettura e controllo del file ----------------------------------------

export type ParseResult = { ok: true; file: BackupFile } | { ok: false; reason: 'format' | 'newer' | 'user' | 'refs' | 'broken' };

const TABLES = ['macros', 'categories', 'merchants', 'transactions', 'recurrences', 'installments', 'meta'] as const;

/** Legge il testo del file e controlla forma, utente e riferimenti tra le righe. */
export function parseBackup(text: string, userId: string, localIds?: { categories: Set<string>; merchants: Set<string> }): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'format' };
  }
  const f = raw as Partial<BackupFile> | null;
  if (!f || f.app !== 'quadra' || typeof f.format !== 'number') return { ok: false, reason: 'format' };
  if (f.format > BACKUP_FORMAT) return { ok: false, reason: 'newer' };
  for (const k of TABLES) if (!Array.isArray(f[k])) return { ok: false, reason: 'broken' };
  for (const k of ['budgets', 'budgetLines', 'refBalances'] as const) if (f[k] !== undefined && !Array.isArray(f[k])) return { ok: false, reason: 'broken' };
  if (f.userId !== userId) return { ok: false, reason: 'user' };
  const file = { ...f, budgets: f.budgets ?? [], budgetLines: f.budgetLines ?? [], refBalances: f.refBalances ?? [] } as BackupFile & { budgets: Budget[]; budgetLines: BudgetLine[]; refBalances: ReferenceBalance[] };

  // ogni riferimento deve trovare la sua riga: nel file o già sul dispositivo
  const cats = new Set([...file.categories.map((c) => c.id), ...(localIds?.categories ?? [])]);
  const mers = new Set([...file.merchants.map((m) => m.id), ...(localIds?.merchants ?? [])]);
  const macroIds = new Set(file.macros.map((m) => m.id));
  const recIds = new Set(file.recurrences.map((r) => r.id));
  const budgetIds = new Set(file.budgets.map((b) => b.id));
  const ok =
    file.categories.every((c) => macroIds.has(c.macro_id) || !!c.deleted_at) &&
    file.transactions.every((x) => x.lines.every((l) => cats.has(l.category_id)) && (!x.merchant_id || mers.has(x.merchant_id))) &&
    file.recurrences.every((r) => cats.has(r.category_id) && (!r.merchant_id || mers.has(r.merchant_id))) &&
    file.installments.every((i) => recIds.has(i.recurrence_id)) &&
    file.budgetLines.every((l) => budgetIds.has(l.budget_id) && (l.category_id ? cats.has(l.category_id) : true)) &&
    file.refBalances.every((r) => (r.category_id ? cats.has(r.category_id) : true));
  return ok ? { ok: true, file } : { ok: false, reason: 'refs' };
}

// ----- confronto e ripristino ----------------------------------------------

/** Campi di servizio: non contano per dire se due righe sono uguali. */
const SERVICE = new Set(['client_modified_at', 'updated_at', 'user_id']);

/** Serializzazione stabile, senza campi di servizio, per confrontare due righe. */
function fingerprint(row: object): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !SERVICE.has(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)]))
    : v;
  return JSON.stringify(sort(row));
}

export interface TableDiff {
  added: number;   // nel file e non sul dispositivo
  changed: number; // in entrambi ma diverse: vince il file
  same: number;
}

export interface RestorePlan {
  macros: TableDiff;
  categories: TableDiff;
  merchants: TableDiff;
  transactions: TableDiff;
  recurrences: TableDiff;
  installments: TableDiff;
  budget: TableDiff; // testate, righe e saldi di riferimento insieme
  /** Righe del dispositivo che il file non conosce: restano dove sono. */
  extra: number;
  /** Righe da scrivere (aggiunte + modificate), esclusi gli accessori. */
  toWrite: number;
}

type Keyed = { id: string };

function diffOf<T extends Keyed>(file: T[], local: T[]): { diff: TableDiff; rows: T[] } {
  const byId = new Map(local.map((r) => [r.id, r]));
  const diff: TableDiff = { added: 0, changed: 0, same: 0 };
  const rows: T[] = [];
  for (const r of file) {
    const cur = byId.get(r.id);
    if (!cur) { diff.added++; rows.push(r); }
    else if (fingerprint(cur) !== fingerprint(r)) { diff.changed++; rows.push(r); }
    else diff.same++;
  }
  return { diff, rows };
}

async function locals(db: QuadraDB) {
  const [macros, categories, merchants, transactions, recurrences, installments, budgets, budgetLines, refBalances] = await Promise.all([
    db.macros.toArray(), db.categories.toArray(), db.merchants.toArray(),
    db.transactions.toArray(), db.recurrences.toArray(), db.installments.toArray(),
    db.budgets.toArray(), db.budgetLines.toArray(), db.refBalances.toArray(),
  ]);
  return { macros, categories, merchants, transactions, recurrences, installments, budgets, budgetLines, refBalances };
}

/** Cosa cambierebbe un ripristino, senza scrivere nulla. */
export async function planRestore(db: QuadraDB, file: BackupFile): Promise<RestorePlan> {
  const l = await locals(db);
  const d = {
    macros: diffOf(file.macros, l.macros),
    categories: diffOf(file.categories, l.categories),
    merchants: diffOf(file.merchants, l.merchants),
    transactions: diffOf(file.transactions, l.transactions),
    recurrences: diffOf(file.recurrences, l.recurrences),
    installments: diffOf(file.installments, l.installments),
    budgets: diffOf(file.budgets ?? [], l.budgets),
    budgetLines: diffOf(file.budgetLines ?? [], l.budgetLines),
    refBalances: diffOf(file.refBalances ?? [], l.refBalances),
  };
  const inFile = (rows: Keyed[]) => new Set(rows.map((r) => r.id));
  const extra =
    l.macros.filter((r) => !inFile(file.macros).has(r.id)).length +
    l.categories.filter((r) => !inFile(file.categories).has(r.id)).length +
    l.merchants.filter((r) => !inFile(file.merchants).has(r.id)).length +
    l.transactions.filter((r) => !inFile(file.transactions).has(r.id)).length +
    l.recurrences.filter((r) => !inFile(file.recurrences).has(r.id)).length +
    l.installments.filter((r) => !inFile(file.installments).has(r.id)).length +
    l.budgets.filter((r) => !inFile(file.budgets ?? []).has(r.id)).length +
    l.budgetLines.filter((r) => !inFile(file.budgetLines ?? []).has(r.id)).length +
    l.refBalances.filter((r) => !inFile(file.refBalances ?? []).has(r.id)).length;
  const toWrite = Object.values(d).reduce((n, x) => n + x.diff.added + x.diff.changed, 0);
  return {
    macros: d.macros.diff, categories: d.categories.diff, merchants: d.merchants.diff,
    transactions: d.transactions.diff, recurrences: d.recurrences.diff, installments: d.installments.diff,
    budget: [d.budgets.diff, d.budgetLines.diff, d.refBalances.diff].reduce((a, x) => ({ added: a.added + x.added, changed: a.changed + x.changed, same: a.same + x.same }), { added: 0, changed: 0, same: 0 }),
    extra, toWrite,
  };
}

/**
 * Ripristina: le righe del file vincono su quelle del dispositivo; quelle che il
 * file non conosce restano. Ogni riga scritta prende l'ora di adesso come
 * modifica (così vince anche sul server) ed entra nella coda di invio. Il
 * ripristino vale anche su un dispositivo vuoto.
 */
export async function applyRestore(db: QuadraDB, file: BackupFile): Promise<number> {
  const l = await locals(db);
  const stamp = new Date().toISOString();
  const w = {
    macros: diffOf(file.macros, l.macros).rows,
    categories: diffOf(file.categories, l.categories).rows,
    merchants: diffOf(file.merchants, l.merchants).rows,
    transactions: diffOf(file.transactions, l.transactions).rows,
    recurrences: diffOf(file.recurrences, l.recurrences).rows,
    installments: diffOf(file.installments, l.installments).rows,
    budgets: diffOf(file.budgets ?? [], l.budgets).rows,
    budgetLines: diffOf(file.budgetLines ?? [], l.budgetLines).rows,
    refBalances: diffOf(file.refBalances ?? [], l.refBalances).rows,
  };
  const touchedPlans = new Set<string>(w.recurrences.map((r) => r.id));
  for (const i of w.installments) touchedPlans.add(i.recurrence_id); // le rate viaggiano con il loro piano

  await db.transaction('rw', [db.macros, db.categories, db.merchants, db.transactions, db.recurrences, db.installments, db.budgets, db.budgetLines, db.refBalances, db.outbox, db.meta, db.profile], async () => {
    if (file.profile && !(await db.profile.get(file.profile.id))) await db.profile.put(file.profile);
    for (const r of w.macros) {
      await db.macros.put({ ...r, client_modified_at: stamp, updated_at: stamp });
      await db.outbox.put({ key: `macro:${r.id}`, kind: 'macro', id: r.id });
    }
    for (const r of w.categories) {
      await db.categories.put({ ...r, client_modified_at: stamp, updated_at: stamp });
      await db.outbox.put({ key: `cat:${r.id}`, kind: 'cat', id: r.id });
    }
    for (const r of w.merchants) {
      await db.merchants.put({ ...r, client_modified_at: stamp });
      await db.outbox.put({ key: `merchant:${r.id}`, kind: 'merchant', id: r.id });
    }
    for (const r of w.installments) await db.installments.put({ ...r, client_modified_at: stamp });
    for (const r of w.recurrences) await db.recurrences.put({ ...r, client_modified_at: stamp });
    for (const id of touchedPlans) await db.outbox.put({ key: `rec:${id}`, kind: 'rec', id });
    for (const r of w.transactions) {
      await db.transactions.put({ ...r, client_modified_at: stamp });
      await db.outbox.put({ key: `tx:${r.id}`, kind: 'tx', id: r.id });
    }
    for (const r of w.budgets) {
      await db.budgets.put({ ...r, client_modified_at: stamp, updated_at: stamp });
      await db.outbox.put({ key: `budget:${r.id}`, kind: 'budget', id: r.id });
    }
    for (const r of w.budgetLines) {
      await db.budgetLines.put({ ...r, client_modified_at: stamp, updated_at: stamp });
      await db.outbox.put({ key: `bline:${r.id}`, kind: 'bline', id: r.id });
    }
    for (const r of w.refBalances) {
      await db.refBalances.put({ ...r, client_modified_at: stamp, updated_at: stamp });
      await db.outbox.put({ key: `refbal:${r.id}`, kind: 'refbal', id: r.id });
    }
    // preferenze e viaggi: si ripristinano solo quelle che sul dispositivo mancano
    for (const m of file.meta) if (!(await db.meta.get(m.key))) await db.meta.put(m);
    await db.meta.bulkDelete(['grid:expense', 'grid:income']);
  });
  return w.macros.length + w.categories.length + w.merchants.length + w.transactions.length + w.recurrences.length + w.installments.length +
    w.budgets.length + w.budgetLines.length + w.refBalances.length;
}

/** Giorni dall'ultimo backup (null se non è mai stato fatto). */
export function daysSince(iso: string | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / 86_400_000);
}
