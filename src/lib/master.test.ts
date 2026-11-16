import { describe, expect, it } from 'vitest';
import {
  canArchiveCategory, canArchiveMacro, canDeleteCategory, canDeleteMacro, canDeleteMerchant, categoryNameProblem, categoryUsage,
  checkMerchantRename, macroFlag, macroNameProblem, macroUsage, mainMerchantId, mergeMerchants, merchantNameMap, merchantRows,
  moveRow, nextSortOrder, shadeChoices, slotOwner, MACRO_COLORS,
} from './master';
import { COMMON_ICONS, IT_WORDS, iconExists, searchIcons } from './icons';
import type { Category, Macro, Merchant, Recurrence, Transaction } from './types';

const sync = { user_id: 'u', updated_at: '', client_modified_at: '', deleted_at: null };
const macro = (id: string, name: string, kind: 'expense' | 'income' = 'expense', extra: Partial<Macro> = {}): Macro =>
  ({ ...sync, id, tx_kind: kind, name, icon: 'house', color: '#3987e5', sort_order: 1, archived: false, ...extra });
const cat = (id: string, macroId: string, name: string, extra: Partial<Category> = {}): Category =>
  ({ ...sync, id, macro_id: macroId, name, icon: 'tag', shade: null, flag: 'essential', pinned_slot: null, sort_order: 1, archived: false, ...extra });
const tx = (id: string, lines: [string, ('essential' | 'discretionary' | null)?][], extra: Partial<Transaction> = {}): Transaction => ({
  id, tx_kind: 'expense', total: 10, tx_date: '2026-11-10', merchant_id: null, note: null, status: 'confirmed', accrual_mode: 'same',
  fx_status: 'none', recurrence_id: null, occurrence_date: null, installment_id: null, client_modified_at: '', deleted_at: null,
  lines: lines.map(([category_id, o]) => ({ category_id, amount: 10 / lines.length, flag_override: o ?? null })), ...extra,
});
const rec = (id: string, categoryId: string, extra: Partial<Recurrence> = {}): Recurrence => ({
  id, name: `Ric ${id}`, kind: 'fixed', tx_kind: 'expense', category_id: categoryId, merchant_id: null, note: null, reference_amount: 10,
  currency: 'EUR', interval_n: 1, interval_unit: 'month', anchor: null, anchor_day: null, start_date: '2026-01-01', end_date: null,
  max_occurrences: null, notify_days_before: 1, active: true, client_modified_at: '', deleted_at: null, ...extra,
});
const merchant = (id: string, name: string, into: string | null = null, deleted = false): Merchant =>
  ({ id, name, merged_into_id: into, client_modified_at: '', deleted_at: deleted ? '2026-01-01' : null });

const macros = [macro('casa', 'Casa'), macro('svago', 'Svago'), macro('ent', 'Entrate', 'income'), macro('vecchia', 'Vecchia', 'expense', { archived: true })];
const byId = new Map(macros.map((m) => [m.id, m]));
const cats = [
  cat('boll', 'casa', 'Bollette', { pinned_slot: 3 }), cat('bar', 'svago', 'Bar', { flag: 'discretionary' }),
  cat('stip', 'ent', 'Stipendio', { pinned_slot: 3 }), cat('arch', 'casa', 'Mutuo', { archived: true }), cat('inmacro', 'vecchia', 'Hobby'),
];

describe('nomi di categorie e macro', () => {
  it('vuoto e troppo lungo', () => {
    expect(categoryNameProblem('  ', 'expense', null, cats, byId)).toBe('empty');
    expect(categoryNameProblem('x'.repeat(41), 'expense', null, cats, byId)).toBe('long');
  });
  it('doppione tra le attive dello stesso tipo, maiuscole e spazi ignorati', () => {
    expect(categoryNameProblem(' bollette ', 'expense', null, cats, byId)).toBe('duplicate');
    expect(categoryNameProblem('BAR', 'expense', null, cats, byId)).toBe('duplicate');
  });
  it('la categoria stessa, un altro tipo, le archiviate e quelle di una macro archiviata non contano', () => {
    expect(categoryNameProblem('Bollette', 'expense', 'boll', cats, byId)).toBeNull();
    expect(categoryNameProblem('Stipendio', 'expense', null, cats, byId)).toBeNull();
    expect(categoryNameProblem('Mutuo', 'expense', null, cats, byId)).toBeNull();
    expect(categoryNameProblem('Hobby', 'expense', null, cats, byId)).toBeNull();
  });
  it('"Altre" è un nome libero', () => expect(categoryNameProblem('Altre', 'expense', null, cats, byId)).toBeNull());
  it('ripristinare una categoria con un nome ora occupato è un doppione', () => {
    const more = [...cats, cat('mutuo2', 'casa', 'mutuo')];
    expect(categoryNameProblem('Mutuo', 'expense', 'arch', more, byId)).toBe('duplicate');
  });
  it('macro: stesso nome solo tra le attive dello stesso tipo', () => {
    expect(macroNameProblem('casa', 'expense', null, macros)).toBe('duplicate');
    expect(macroNameProblem('Casa', 'income', null, macros)).toBeNull();
    expect(macroNameProblem('Vecchia', 'expense', null, macros)).toBeNull();
    expect(macroNameProblem('Casa', 'expense', 'casa', macros)).toBeNull();
  });
});

describe('uso di una categoria', () => {
  const txs = [
    tx('1', [['bar']]), tx('2', [['bar', 'essential']]), tx('3', [['bar'], ['boll']]), tx('4', [['bar']], { deleted_at: '2026-11-11' }),
    tx('5', [['boll']]), tx('6', [['bar', 'essential'], ['bar']]),
  ];
  const recs = [rec('a', 'bar'), rec('b', 'bar', { active: false }), rec('c', 'bar', { deleted_at: '2026-01-01' }), rec('d', 'boll')];
  it('conta i movimenti non cancellati e quelli che seguono il tipo di spesa della categoria', () => {
    const u = categoryUsage('bar', txs, recs);
    expect(u.movements).toBe(4);
    expect(u.followFlag).toBe(3); // il 2 ha l'override; il 6 ha una riga senza
    expect(u.activeRecurrences).toEqual(['Ric a']);
    expect(u.recurrences).toBe(2);
  });
  it('con storia si archivia soltanto; con una ricorrenza attiva nemmeno', () => {
    const u = categoryUsage('bar', txs, recs);
    expect(canDeleteCategory(u)).toBe(false);
    expect(canArchiveCategory(u)).toBe(false);
    const ended = categoryUsage('bar', txs, [rec('b', 'bar', { active: false })]);
    expect(canArchiveCategory(ended)).toBe(true);
    expect(canDeleteCategory(ended)).toBe(false);
  });
  it('senza movimenti né ricorrenze si elimina', () => {
    expect(canDeleteCategory(categoryUsage('stip', txs, recs))).toBe(true);
  });
});

describe('uso di una macro', () => {
  it('si elimina solo se vuota, si archivia se nessuna ricorrenza attiva la usa', () => {
    const u = macroUsage(macros[0], macros, cats, [rec('a', 'boll')]);
    expect(u).toMatchObject({ categories: 2, activeCategories: 1, activeRecurrences: ['Ric a'], lastOfKind: false });
    expect(canDeleteMacro(u)).toBe(false);
    expect(canArchiveMacro(u)).toBe(false);
    // la ricorrenza su una categoria già archiviata non blocca
    expect(canArchiveMacro(macroUsage(macros[0], macros, cats, [rec('a', 'arch')]))).toBe(true);
  });
  it("l'ultima macro attiva di un tipo non si archivia né si elimina", () => {
    const u = macroUsage(macros[2], macros, [], []);
    expect(u.lastOfKind).toBe(true);
    expect(canArchiveMacro(u)).toBe(false);
    expect(canDeleteMacro(u)).toBe(false);
  });
  it('una macro vuota, non ultima, si elimina', () => {
    expect(canDeleteMacro(macroUsage(macros[1], macros, [], []))).toBe(true);
  });
  it('tipo di spesa della macro', () => {
    expect(macroFlag([])).toBeNull();
    expect(macroFlag([cats[0]])).toBe('essential');
    expect(macroFlag([cats[0], cats[1]])).toBe('mixed');
  });
});

describe('ordine e griglia', () => {
  const rows = [{ id: 'a', sort_order: 1 }, { id: 'b', sort_order: 2 }, { id: 'c', sort_order: 3 }];
  it('sposta di un posto e restituisce solo le righe cambiate', () => {
    expect(moveRow(rows, 'c', -1)).toEqual([{ id: 'c', sort_order: 2 }, { id: 'b', sort_order: 3 }]);
    expect(moveRow(rows, 'a', 1)).toEqual([{ id: 'b', sort_order: 1 }, { id: 'a', sort_order: 2 }]);
  });
  it('ai bordi non cambia nulla', () => {
    expect(moveRow(rows, 'a', -1)).toEqual([]);
    expect(moveRow(rows, 'c', 1)).toEqual([]);
    expect(moveRow(rows, 'x', 1)).toEqual([]);
  });
  it('rinumera anche posizioni con buchi o uguali', () => {
    const odd = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 0 }, { id: 'c', sort_order: 7 }];
    expect(moveRow(odd, 'b', -1)).toEqual([{ id: 'b', sort_order: 1 }, { id: 'a', sort_order: 2 }, { id: 'c', sort_order: 3 }]);
  });
  it('posizione di una riga nuova', () => {
    expect(nextSortOrder(rows)).toBe(4);
    expect(nextSortOrder([])).toBe(1);
  });
  it('la casella è occupata solo da una categoria attiva dello stesso tipo', () => {
    expect(slotOwner(3, 'expense', null, cats, byId)?.id).toBe('boll');
    expect(slotOwner(3, 'income', null, cats, byId)?.id).toBe('stip');
    expect(slotOwner(3, 'expense', 'boll', cats, byId)).toBeUndefined();
    expect(slotOwner(4, 'expense', null, cats, byId)).toBeUndefined();
  });
  it('colori: 12 per le macro, 4 sfumature diverse per le categorie', () => {
    expect(new Set(MACRO_COLORS.map((c) => c.toLowerCase())).size).toBe(12);
    for (const c of MACRO_COLORS) expect(new Set(shadeChoices(c)).size).toBe(4);
  });
});

describe('esercizi', () => {
  const ms = [merchant('coop', 'Coop'), merchant('coop2', 'COOP Via Roma', 'coop'), merchant('eni', 'Eni'), merchant('q8', 'Q8'), merchant('old', 'Vecchio', null, true)];
  const txs = [tx('1', [['x']], { merchant_id: 'coop' }), tx('2', [['x']], { merchant_id: 'coop2' }), tx('3', [['x']], { merchant_id: 'eni', deleted_at: 'x' })];
  it('i doppioni prendono il nome del principale', () => {
    const names = merchantNameMap(ms);
    expect(names.get('coop2')).toBe('Coop');
    expect(names.get('eni')).toBe('Eni');
    expect(mainMerchantId('coop2', new Map(ms.map((m) => [m.id, m])))).toBe('coop');
  });
  it('un ciclo non blocca', () => {
    const loop = [merchant('a', 'A', 'b'), merchant('b', 'B', 'a')];
    expect(['a', 'b']).toContain(mainMerchantId('a', new Map(loop.map((m) => [m.id, m]))));
  });
  it('elenco: solo i principali, con doppioni e movimenti sommati', () => {
    const rows = merchantRows(ms, txs, [rec('r', 'x', { merchant_id: 'q8' })]);
    expect(rows.map((r) => r.merchant.name)).toEqual(['Coop', 'Eni', 'Q8']);
    expect(rows[0]).toMatchObject({ movements: 2 });
    expect(rows[0].aliases.map((a) => a.name)).toEqual(['COOP Via Roma']);
    expect(canDeleteMerchant(rows[0])).toBe(false);
    expect(canDeleteMerchant(rows[1])).toBe(true);  // il suo unico movimento è cancellato
    expect(canDeleteMerchant(rows[2])).toBe(false); // usato da una ricorrenza
  });
  it('rinomina: libero, uguale, già esistente, nome di un proprio doppione', () => {
    expect(checkMerchantRename('  Coop  Italia ', ms[0], ms)).toEqual({ ok: true, name: 'Coop Italia' });
    expect(checkMerchantRename('COOP', ms[0], ms)).toEqual({ ok: true, name: 'COOP' }); // solo maiuscole
    expect(checkMerchantRename('Coop', ms[0], ms)).toEqual({ ok: false, problem: 'same' });
    expect(checkMerchantRename('', ms[0], ms)).toEqual({ ok: false, problem: 'empty' });
    expect(checkMerchantRename('eni', ms[3], ms)).toMatchObject({ ok: false, problem: 'exists', other: { id: 'eni' } });
    expect(checkMerchantRename('coop via roma', ms[0], ms)).toEqual({ ok: false, problem: 'alias' });
    // il nome di un doppione altrui porta al suo principale
    expect(checkMerchantRename('coop via roma', ms[2], ms)).toMatchObject({ ok: false, problem: 'exists', other: { id: 'coop' } });
    // un esercizio eliminato libera il nome
    expect(checkMerchantRename('Vecchio', ms[2], ms)).toEqual({ ok: true, name: 'Vecchio' });
  });
  it('fusione: la sorgente e i suoi doppioni passano al principale di destinazione', () => {
    expect(mergeMerchants('coop', 'eni', ms).map((m) => [m.id, m.merged_into_id])).toEqual([['coop', 'eni'], ['coop2', 'eni']]);
    expect(mergeMerchants('eni', 'coop2', ms).map((m) => [m.id, m.merged_into_id])).toEqual([['eni', 'coop']]);
    expect(mergeMerchants('coop2', 'coop', ms)).toEqual([]); // sono già lo stesso esercizio
    expect(mergeMerchants('eni', 'old', ms)).toEqual([]);     // eliminato
  });
});

describe('icone', () => {
  it('tutte le icone con parole italiane esistono', () => {
    expect(Object.keys(IT_WORDS).filter((n) => !iconExists(n))).toEqual([]);
    expect(COMMON_ICONS.length).toBeGreaterThan(190);
  });
  it('ricerca in italiano, senza accenti, per inizio di parola', () => {
    expect(searchIcons('gatto')[0]).toBe('cat');
    expect(searchIcons('caffè')).toContain('coffee');
    expect(searchIcons('benz')[0]).toBe('gas-pump');
    expect(searchIcons('foto')).toEqual(expect.arrayContaining(['camera', 'aperture']));
  });
  it('ricerca per nome inglese su tutte le icone', () => {
    expect(searchIcons('acorn')).toContain('acorn');
    expect(searchIcons('cat').slice(0, 2)).toContain('cat');
  });
  it('senza testo propone le comuni; un testo senza risultati dà un elenco vuoto', () => {
    expect(searchIcons('  ')).toBe(COMMON_ICONS);
    expect(searchIcons('zzzzqq')).toEqual([]);
  });
});
