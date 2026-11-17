import { describe, expect, it } from 'vitest';
import {
  actualsOf, byMacro, guideShares, historyOfLine, membersOf, monthIndex, natureOf, profileFromMonths, programmedItems,
  proposeIntegration, proposeLines, readBudget, readLine, refreshDraft, setMonthWeight, sumByCategory, uniformProfile,
} from './budget';
import type { Budget, BudgetLine, Category, Installment, Macro, Recurrence, ReferenceBalance, Transaction } from './types';

const sync = { user_id: 'u', updated_at: '', client_modified_at: '', deleted_at: null };
const macro = (id: string, tx_kind: Macro['tx_kind'] = 'expense'): Macro => ({ id, tx_kind, name: id, icon: 'x', color: '#000000', sort_order: 0, archived: false, ...sync });
const cat = (id: string, macro_id: string, flag: Category['flag']): Category => ({ id, macro_id, flag, name: id, icon: 'x', shade: null, pinned_slot: null, sort_order: 0, archived: false, ...sync });

const macros = [macro('casa'), macro('mob'), macro('fam'), macro('pass'), macro('ent', 'income')];
const cats = [
  cat('condominio', 'casa', 'essential'), cat('bollette', 'casa', 'essential'),
  cat('auto', 'mob', 'essential'),
  cat('ragazzi', 'fam', 'essential'), cat('regali', 'fam', 'discretionary'),
  cat('foto', 'pass', 'discretionary'), cat('stadio', 'pass', 'discretionary'), cat('tech', 'pass', 'discretionary'),
  cat('stipendio', 'ent', 'essential'), cat('rimborsi', 'ent', 'essential'), cat('usato', 'ent', 'essential'),
];
const macroMap = new Map(macros.map((m) => [m.id, m]));
const catMap = new Map(cats.map((c) => [c.id, c]));

let n = 0;
const tx = (category_id: string, amount: number, date: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, tx_kind: catMap.get(category_id)?.macro_id === 'ent' ? 'income' : 'expense', total: amount, tx_date: date,
  merchant_id: null, note: null, status: 'confirmed', accrual_mode: 'same', fx_status: 'none', recurrence_id: null,
  occurrence_date: null, installment_id: null, client_modified_at: '', deleted_at: null,
  lines: [{ category_id, amount, flag_override: null }], ...extra,
});
const rec = (id: string, category_id: string, amount: number, extra: Partial<Recurrence> = {}): Recurrence => ({
  id, name: id, kind: 'fixed', tx_kind: 'expense', category_id, merchant_id: null, note: null, reference_amount: amount, currency: 'EUR',
  interval_n: 1, interval_unit: 'month', anchor: 'day_of_month', anchor_day: 10, start_date: '2026-01-10', end_date: null,
  max_occurrences: null, notify_days_before: 1, active: true, client_modified_at: '', deleted_at: null, ...extra,
});
const ref = (category_id: string | null, amount: number, extra: Partial<ReferenceBalance> = {}): ReferenceBalance => ({
  id: `r${++n}`, year: 2026, month: null, category_id, macro_id: null, amount, extraordinary: false, origin: 'Monefy', note: null, ...sync, ...extra,
});
const line = (extra: Partial<BudgetLine>): BudgetLine => ({
  id: `l${++n}`, budget_id: 'b', category_id: null, macro_id: null, source: 'manual', history_base: null, adjust_pct: null,
  programmed_original: 0, integration_original: 0, programmed_revised: null, integration_revised: null,
  monthly_profile: null, reviewed: false, note: null, ...sync, ...extra,
});
const budget: Budget = { id: 'b', year: 2027, status: 'draft', approved_at: null, reserve_original: 1500, reserve_revised: null, reserve_pct: 50, note: null, ...sync };

describe('profilo mensile', () => {
  it('uniforme: 12 pesi che sommano esattamente a 100', () => {
    const p = uniformProfile();
    expect(p).toHaveLength(12);
    expect(p.slice(0, 11).every((x) => x === 8.33)).toBe(true);
    expect(Math.round(p.reduce((s, x) => s + x, 0) * 100)).toBe(10000);
  });

  it('ritocco: agosto 30, poi dicembre 15, gli altri si dividono il resto (5,5)', () => {
    const locked = Array(12).fill(false);
    let p = setMonthWeight(uniformProfile(), locked, 7, 30);
    locked[7] = true;
    p = setMonthWeight(p, locked, 11, 15);
    expect(p[7]).toBe(30);
    expect(p[11]).toBe(15);
    expect(p.filter((_, i) => i !== 7 && i !== 11).every((x) => x === 5.5)).toBe(true);
    expect(Math.round(p.reduce((s, x) => s + x, 0) * 100)).toBe(10000);
  });

  it('il valore non supera ciò che lasciano i mesi bloccati', () => {
    const locked = Array(12).fill(false);
    locked[0] = true;
    const start = setMonthWeight(uniformProfile(), Array(12).fill(false), 0, 60);
    const p = setMonthWeight(start, locked, 1, 80);
    expect(p[0]).toBe(60);
    expect(p[1]).toBe(40);
    expect(p.slice(2).every((x) => x === 0)).toBe(true);
  });

  it('dallo storico mensile, con la somma a 100', () => {
    const months = [110, 110, 110, 110, 110, 110, 110, 600, 110, 110, 110, 300].map((x) => x * 100);
    const p = profileFromMonths(months)!;
    expect(p[7]).toBe(30);
    expect(p[11]).toBe(15);
    expect(Math.round(p.reduce((s, x) => s + x, 0) * 100)).toBe(10000);
    expect(profileFromMonths(Array(12).fill(0))).toBeNull();
  });
});

describe('programmato', () => {
  it('scadenze dell\'anno: generate col loro importo, le altre stimate; le cancellate non contano', () => {
    const r = rec('vodafone', 'bollette', 30, { start_date: '2026-11-10' });
    const txs = [
      tx('bollette', 31, '2027-01-10', { recurrence_id: 'vodafone', occurrence_date: '2027-01-10' }),
      tx('bollette', 30, '2027-02-10', { recurrence_id: 'vodafone', occurrence_date: '2027-02-10', deleted_at: 'x' }),
    ];
    const items = programmedItems({ year: 2027, recs: [r], installments: [], txs, rates: new Map() });
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(11); // 12 scadenze meno quella cancellata
    // come per la generazione delle scadenze, la stima è l'ultimo importo confermato
    expect(items[0].cents).toBe(3100 + 10 * 3100);
    expect(items[0].pending).toBe(10 * 3100);
  });

  it('variabile: l\'ultimo importo confermato; in valuta: al cambio noto', () => {
    const luce = rec('luce', 'bollette', 80, { kind: 'variable', start_date: '2027-01-15', anchor_day: 15, interval_n: 2 });
    const claude = rec('claude', 'tech', 20, { currency: 'USD', start_date: '2027-01-05', anchor_day: 5 });
    const txs = [tx('bollette', 95, '2026-12-15', { recurrence_id: 'luce', occurrence_date: '2026-12-15' })];
    const items = programmedItems({ year: 2027, recs: [luce, claude], installments: [], txs, rates: new Map([['USD', 1.08]]) });
    const byId = new Map(items.map((i) => [i.recurrenceId, i]));
    expect(byId.get('luce')!.cents).toBe(6 * 9500);
    expect(byId.get('claude')!.cents).toBe(12 * Math.round(2000 / 1.08));
    // senza cambio la scadenza in valuta non si stima
    expect(programmedItems({ year: 2027, recs: [claude], installments: [], txs: [], rates: new Map() })).toHaveLength(0);
  });

  it('piani rate: solo le rate dell\'anno; una ricorrenza terminata tiene la sua storia', () => {
    const plan = rec('cond', 'condominio', 2400, { kind: 'plan' });
    const inst = (seq: number, due: string, amount: number): Installment => ({ id: `i${seq}`, recurrence_id: 'cond', seq, due_date: due, amount, mode: 'auto', client_modified_at: '', deleted_at: null });
    const ended = rec('vecchia', 'auto', 50, { active: false, start_date: '2027-01-10' });
    const txs = [tx('auto', 50, '2027-01-10', { recurrence_id: 'vecchia', occurrence_date: '2027-01-10' })];
    const items = programmedItems({
      year: 2027, recs: [plan, ended], txs, rates: new Map(),
      installments: [inst(1, '2026-12-01', 600), inst(2, '2027-03-01', 600), inst(3, '2027-06-01', 600), inst(4, '2027-09-01', 600)],
    });
    const byId = new Map(items.map((i) => [i.recurrenceId, i]));
    expect(byId.get('cond')!.cents).toBe(180000);
    expect(byId.get('vecchia')!.cents).toBe(5000);
    expect(byId.get('vecchia')!.pending).toBe(0);
  });
});

describe('consuntivo e impegnato', () => {
  it('confermati fino a oggi nel consuntivo; futuri, da confermare e non generati nell\'impegnato', () => {
    const txs = [
      tx('foto', 100, '2027-03-02'),
      tx('foto', 50, '2027-07-20'),                                  // data futura
      tx('foto', 40, '2027-03-05', { status: 'scheduled' }),         // da confermare
      tx('foto', 1200, '2027-02-10', { accruals: [{ period: '2027-02-01', amount: 600 }, { period: '2027-08-01', amount: 600 }] }),
      tx('foto', 999, '2026-12-30'),                                 // altro anno
      tx('foto', 70, '2027-03-01', { deleted_at: 'x' }),
    ];
    const items = [{ recurrenceId: 'x', name: 'x', categoryId: 'tech', cents: 5000, count: 2, pending: 2000 }];
    const a = actualsOf(txs, 2027, '2027-06-30', items);
    expect(a.actual.get('foto')).toBe(10000 + 60000);
    expect(a.committed.get('foto')).toBe(5000 + 4000 + 60000);
    expect(a.committed.get('tech')).toBe(2000);
  });
});

describe('storico e proposte', () => {
  const lines = [line({ macro_id: 'pass' }), line({ category_id: 'foto' })];
  const refs = [
    ref('foto', 1105.9), ref('stadio', 600), ref('tech', 300),
    ref('tech', 100, { month: 8 }),                       // c'è l'annuale: il mensile non si somma
    ref('stadio', 2920, { extraordinary: true }),         // straordinaria: fuori dalla base
    ref('regali', 900, { year: 2025 }),                   // altro anno
  ];

  it('il tetto comune copre le discrezionali senza tetto dedicato', () => {
    expect(membersOf(lines[0], lines, catMap).sort()).toEqual(['stadio', 'tech']);
    expect(natureOf(lines[0], catMap, macroMap)).toBe('common');
    expect(natureOf(lines[1], catMap, macroMap)).toBe('dedicated');
    expect(natureOf(line({ category_id: 'auto' }), catMap, macroMap)).toBe('forecast');
    expect(natureOf(line({ category_id: 'stipendio' }), catMap, macroMap)).toBe('income');
  });

  it('storico della riga: categoria, oppure somma del tetto comune senza straordinarie', () => {
    expect(historyOfLine(lines[1], lines, refs, catMap, 2027)).toBe(110590);
    expect(historyOfLine(lines[0], lines, refs, catMap, 2027)).toBe(90000);
  });

  it('saldo di una macro intera: solo per macro tutte discrezionali e senza tetti dedicati', () => {
    const macroRef = [ref(null, 2700, { macro_id: 'pass' }), ref(null, 6000, { macro_id: 'fam' })];
    const common = line({ macro_id: 'pass' });
    expect(historyOfLine(common, [common], macroRef, catMap, 2027)).toBe(270000);
    expect(historyOfLine(common, [common, line({ category_id: 'foto' })], macroRef, catMap, 2027)).toBeNull();
    expect(historyOfLine(line({ macro_id: 'fam' }), [], macroRef, catMap, 2027)).toBeNull(); // macro mista
  });

  it('integrazione = storico × (1 + ritocco) − programmato, mai sotto zero', () => {
    expect(proposeIntegration(172000, 3, 105000)).toBe(72160);
    expect(proposeIntegration(30000, 0, 48000)).toBe(0);
  });

  it('ripartizione indicativa dalle quote dello storico', () => {
    const g = guideShares(['stadio', 'tech'], refs, 2026);
    expect(g.get('stadio')).toBeCloseTo(600 / 900);
    expect(g.get('tech')).toBeCloseTo(300 / 900);
  });
});

describe('costruzione e bozza viva', () => {
  const refs = [ref('bollette', 2300), ref('auto', 1720), ref('stipendio', 37000), ref('foto', 1200), ref('stadio', 600), ref('regali', 500)];
  const programmed = new Map([['bollette', 215000], ['auto', 105000], ['tech', 12000]]);

  it('una previsione per essenziale, un tetto comune per macro con discrezionali, le entrate con storico', () => {
    const d = proposeLines(2027, macros, cats, refs, programmed);
    const key = (x: { category_id: string | null; macro_id: string | null }) => x.category_id ?? `M:${x.macro_id}`;
    expect(d.map(key).sort()).toEqual(['M:fam', 'M:pass', 'auto', 'bollette', 'condominio', 'ragazzi', 'stipendio'].sort());
    const bollette = d.find((x) => x.category_id === 'bollette')!;
    expect(bollette).toMatchObject({ source: 'history', history_base: 2300, programmed_original: 2150, integration_original: 150 });
    const condominio = d.find((x) => x.category_id === 'condominio')!;
    expect(condominio).toMatchObject({ source: 'manual', integration_original: 0 });
    const pass = d.find((x) => x.macro_id === 'pass')!;
    expect(pass).toMatchObject({ history_base: 1800, programmed_original: 120, integration_original: 1680 });
  });

  it('il programmato segue le ricorrenze; lo storico cambia solo le voci non toccate', () => {
    const touched = line({ category_id: 'auto', source: 'history', history_base: 1720, adjust_pct: 3, programmed_original: 1050, integration_original: 600, reviewed: true });
    const fresh = line({ category_id: 'bollette', source: 'history', history_base: 2000, adjust_pct: 0, programmed_original: 2150, integration_original: 0 });
    const empty = line({ category_id: 'condominio', source: 'manual' });
    const newProg = new Map([['auto', 110000], ['bollette', 215000]]);
    const newRefs = [...refs, ref('condominio', 2350)];
    const out = refreshDraft([touched, fresh, empty], catMap, newRefs, newProg, 2027);
    const byCat = new Map(out.map((l) => [l.category_id, l]));
    expect(byCat.get('auto')).toMatchObject({ programmed_original: 1100, integration_original: 600 });
    expect(byCat.get('bollette')).toMatchObject({ history_base: 2300, integration_original: 150 });
    expect(byCat.get('condominio')).toMatchObject({ source: 'history', history_base: 2350, integration_original: 2350 });
    // nulla cambia: nessuna riga da riscrivere
    expect(refreshDraft(out.map((l) => ({ ...l })), catMap, newRefs, newProg, 2027)).toHaveLength(0);
  });
});

describe('lettura', () => {
  const profile = [5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 30, 5.5, 5.5, 5.5, 15];
  const common = line({ macro_id: 'pass', programmed_original: 120, integration_original: 780, monthly_profile: profile });
  const foto = line({ category_id: 'foto', integration_original: 1200 });
  const auto = line({ category_id: 'auto', programmed_original: 1050, integration_original: 722 });
  const stip = line({ category_id: 'stipendio', integration_original: 37200 });
  const rimb = line({ category_id: 'rimborsi', integration_original: 800 });
  const lines = [common, foto, auto, stip, rimb];
  const a = {
    actual: new Map([['foto', 131000], ['tech', 26000], ['auto', 179000], ['stipendio', 1860000], ['usato', 32000], ['regali', 5000]]),
    committed: new Map([['auto', 27000], ['tech', 0]]),
  };

  it('mese dell\'anno del budget', () => {
    expect(monthIndex(2027, '2026-12-20')).toBe(0);
    expect(monthIndex(2027, '2027-06-30')).toBe(6);
    expect(monthIndex(2027, '2028-01-02')).toBe(13);
  });

  it('tetto con profilo: budget YTD, scostamento e quanto spendere nel mese', () => {
    const r = readLine(common, lines, catMap, macroMap, a, 6);
    expect(r.budget).toBe(90000);
    expect(r.ytdBudget).toBe(Math.round(90000 * 0.33));
    expect(r.ytdDelta).toBe(26000 - 29700);
    expect(r.available).toBe(64000);
    expect(r.perMonth).toBe(Math.round((64000 * 550) / 7250)); // giugno pesa 5,5 sui 72,5 punti da giugno a dicembre
    expect(readLine(common, lines, catMap, macroMap, a, 7).perMonth).toBe(Math.round((64000 * 550) / 6700));
  });

  it('previsione: niente YTD; tetto dedicato sforato', () => {
    expect(readLine(auto, lines, catMap, macroMap, a, 6)).toMatchObject({ budget: 177200, actual: 179000, committed: 27000, ytdBudget: null });
    expect(readLine(foto, lines, catMap, macroMap, a, 6).available).toBe(-11000);
  });

  it('risultato atteso, con la sola entrata principale, a oggi; extra e fuori budget', () => {
    const r = readBudget(budget, lines, catMap, macroMap, a, '2027-06-30');
    expect(r.reserve).toBe(150000);
    expect(r.expenseBudget).toBe(90000 + 120000 + 177200 + 150000);
    expect(r.incomeBudget).toBe(3800000);
    expect(r.result).toBe(3800000 - r.expenseBudget);
    expect(r.primaryIncome?.line.category_id).toBe('stipendio');
    expect(r.resultPrimary).toBe(3720000 - r.expenseBudget);
    expect(r.resultToDate).toBe(1860000 + 32000 - (131000 + 26000 + 179000 + 5000));
    expect(r.extraIncome).toBe(32000);
    expect(r.outOfBudget).toBe(5000); // Regali non ha budget
    const groups = byMacro(r, macros, catMap);
    const pass = groups.find((g) => g.macro.id === 'pass')!;
    expect(pass.caps.map((c) => c.nature)).toEqual(['dedicated', 'common']);
    expect(pass.overCap?.line.category_id).toBe('foto');
    expect(groups.find((g) => g.macro.id === 'mob')!.forecast).toHaveLength(1);
  });

  it('sumByCategory', () => {
    expect(sumByCategory([{ categoryId: 'a', cents: 1 }, { categoryId: 'a', cents: 2 }]).get('a')).toBe(3);
  });
});

describe('anno non ancora iniziato', () => {
  it('niente YTD né "al mese" sui tetti', () => {
    const l = line({ macro_id: 'pass', integration_original: 900 });
    const r = readLine(l, [l], catMap, macroMap, { actual: new Map(), committed: new Map() }, 0);
    expect(r.ytdBudget).toBeNull();
    expect(r.perMonth).toBeNull();
  });
});
