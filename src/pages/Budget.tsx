import { useMemo, useState } from 'react';
import { BottomBar } from '../components/BottomBar';
import { SyncPill } from '../components/SyncPill';
import {
  byMacro, extraordinaryOf, lineBudget, proposeLines, readBudget, type LineReading, type MacroReading,
} from '../lib/budget';
import { useBudgetData } from '../lib/budgetData';
import { writeBudget } from '../lib/budgetWrite';
import type { QuadraDB } from '../lib/db';
import { todayISO } from '../lib/dates';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { blankSync } from '../lib/masterWrite';
import { toCents } from '../lib/money';
import type { Nav } from '../lib/nav';
import type { BudgetLine } from '../lib/types';

/** Anno proposto all'apertura: da novembre si prepara quello successivo, se non c'è già quello in corso. */
export function defaultBudgetYear(today: string, years: number[]): number {
  const y = Number(today.slice(0, 4));
  if (years.includes(y) && !(Number(today.slice(5, 7)) >= 11 && years.includes(y + 1))) return y;
  return Number(today.slice(5, 7)) >= 11 ? y + 1 : y;
}

export function Budget({ db, master, nav, userId, year, setYear, currency, pending, onSync }: {
  db: QuadraDB;
  master: MasterData;
  nav: Nav;
  userId: string;
  year: number;
  setYear: (y: number) => void;
  currency: string;
  pending: number;
  onSync: () => void;
}) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const data = useBudgetData(db, year, today, master.categoryById, onSync);
  const [confirm, setConfirm] = useState<'approve' | 'reopen' | null>(null);
  const money = (cents: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0, useGrouping: 'always' }).format(cents / 100);
  const signed = (cents: number) => (cents > 0 ? `+${money(cents)}` : cents < 0 ? `−${money(-cents)}` : money(0));

  const reading = useMemo(
    () => (data.budget ? readBudget(data.budget, data.lines, master.categoryById, master.macroById, data.actuals, today) : null),
    [data.budget, data.lines, master, data.actuals, today],
  );
  const groups = useMemo(() => (reading ? byMacro(reading, master.macros, master.categoryById) : []), [reading, master]);

  const thisYear = Number(today.slice(0, 4));
  const choices = [...new Set([thisYear, thisYear + 1, ...data.years])].sort();
  const refsPrev = data.refs.filter((r) => r.year === year - 1).length;

  async function build() {
    const reservePct = 50;
    const extra = extraordinaryOf(data.refs, year - 1);
    const b = { ...blankSync(userId), year, status: 'draft' as const, approved_at: null, reserve_original: Math.round((extra * reservePct) / 100) / 100, reserve_revised: null, reserve_pct: reservePct, note: null };
    const drafts = proposeLines(year, master.macros, [...master.categoryById.values()], data.refs, data.programmed);
    const lines: BudgetLine[] = drafts.map((d) => ({
      ...blankSync(userId), budget_id: b.id, ...d, programmed_revised: null, integration_revised: null, monthly_profile: null, reviewed: false, note: null,
    }));
    await writeBudget(db, { budgets: [b], lines });
    onSync();
  }

  async function setStatus(status: 'draft' | 'approved') {
    if (!data.budget) return;
    if (confirm !== (status === 'approved' ? 'approve' : 'reopen')) {
      setConfirm(status === 'approved' ? 'approve' : 'reopen');
      return;
    }
    setConfirm(null);
    await writeBudget(db, { budgets: [{ ...data.budget, status, approved_at: status === 'approved' ? new Date().toISOString() : null }] });
    onSync();
  }

  const header = (
    <header className="topbar">
      <h1 className="st-title">{t('nav.budget')}</h1>
      <div className="segmented basis" role="group" aria-label={t('bu.year')}>
        {choices.map((y) => (
          <button key={y} type="button" aria-pressed={y === year} onClick={() => { setYear(y); setConfirm(null); }}>{y}</button>
        ))}
      </div>
    </header>
  );

  if (!data.ready || !master.ready) {
    return (<main className="page with-bar" aria-busy="true">{header}<BottomBar nav={nav} /></main>);
  }

  const toReview = data.lines.filter((l) => !l.reviewed).length;
  const storico = (
    <button type="button" className="filter" onClick={() => nav.go({ name: 'refBalances', year: year - 1 })}>
      <i className="ph ph-clock-counter-clockwise" aria-hidden="true" /> {t('bu.history', { year: year - 1 })}
    </button>
  );

  // ----- nessun budget per l'anno ------------------------------------------
  if (!data.budget || !reading) {
    return (
      <main className="page with-bar">
        {header}
        <SyncPill pending={pending} onClick={() => nav.go({ name: 'settings' })} />
        <section className="card">
          <h2>{t('bu.empty.title', { year })}</h2>
          <p className="small">{t('bu.empty.body')}</p>
          <ol className="bu-steps small">
            <li>{t('bu.empty.step1', { year: year - 1 })} <span className="muted">{refsPrev > 0 ? t('bu.empty.refs', { n: refsPrev }) : t('bu.empty.noRefs')}</span></li>
            <li>{t('bu.empty.step2', { year })} <span className="muted">{t('bu.empty.recs', { n: data.items.length })}</span></li>
            <li>{t('bu.empty.step3')}</li>
          </ol>
          <button type="button" className="secondary" onClick={() => nav.go({ name: 'refBalances', year: year - 1 })}>
            <i className="ph ph-clock-counter-clockwise" aria-hidden="true" /> {t('bu.history', { year: year - 1 })}
          </button>
          <button type="button" className="primary" onClick={() => void build()}>{t('bu.build', { year })}</button>
        </section>
        <BottomBar nav={nav} />
      </main>
    );
  }

  const r = reading;
  const draft = data.budget.status === 'draft';
  const primaryName = r.primaryIncome ? master.categoryById.get(r.primaryIncome.line.category_id!)?.name ?? '' : '';
  const incomes = r.lines.filter((x) => x.nature === 'income');

  // ----- costruzione (bozza) ------------------------------------------------
  if (draft) {
    const catName = (id: string | null) => (id ? master.categoryById.get(id)?.name ?? '?' : '');
    const lineRow = (lr: LineReading, label: string) => {
      const l = lr.line;
      const sourceLabel = t(`bu.src.${l.source}`) + (l.source === 'history' && l.adjust_pct ? ` ${l.adjust_pct > 0 ? '+' : ''}${l.adjust_pct}%` : '');
      const prog = toCents(l.programmed_original);
      return (
        <button key={l.id} type="button" className="bu-line" onClick={() => nav.go({ name: 'budgetLine', id: l.id })}>
          <span className="bu-line-main">
            <span className="bu-line-name">
              {!l.reviewed && <span className="bu-todo" aria-label={t('bu.toReview.one')} />}
              {label}
            </span>
            <span className="bu-line-sub">
              <span className="bu-src">{sourceLabel}</span>
              <span className="muted tiny num">{prog > 0 ? t('bu.progPlus', { prog: money(prog), int: money(toCents(l.integration_original)) }) : ''}</span>
            </span>
          </span>
          <span className="num small">{money(lineBudget(l))}</span>
        </button>
      );
    };
    const covered = new Set(r.lines.flatMap((x) => x.members));
    const missing = master.categories.filter((c) => !covered.has(c.id) && (c.flag === 'essential' || master.macroById.get(c.macro_id)?.tx_kind === 'income'));
    const addLine = (categoryId: string) =>
      writeBudget(db, {
        lines: [{
          ...blankSync(userId), budget_id: data.budget!.id, category_id: categoryId, macro_id: null, source: 'manual', history_base: null, adjust_pct: null,
          programmed_original: (data.programmed.get(categoryId) ?? 0) / 100, integration_original: 0, programmed_revised: null, integration_revised: null,
          monthly_profile: null, reviewed: false, note: null,
        }],
      }).then(onSync);
    const extra = extraordinaryOf(data.refs, year - 1);
    return (
      <main className="page with-bar">
        {header}
        <SyncPill pending={pending} onClick={() => nav.go({ name: 'settings' })} />
        <div className="row">
          <span className="badge">{t('bu.draft')}</span>
          <span className={toReview > 0 ? 'small bu-warn' : 'small muted'}>
            {toReview > 0 ? t(toReview === 1 ? 'bu.toReview.one' : 'bu.toReview.many', { n: toReview }) : t('bu.allReviewed')}
          </span>
        </div>
        {storico}

        {groups.map((g) => (
          <section key={g.macro.id} className="card bu-macro">
            <div className="row bu-macro-head">
              <span className="bu-macro-name"><span className="bu-dot" style={{ background: g.macro.color }} />{g.macro.name}<span className="muted tiny">{t(`bu.kind.${kindOf(g)}`)}</span></span>
              <span className="num strong">{money(g.budget)}</span>
            </div>
            {g.forecast.map((lr) => lineRow(lr, catName(lr.line.category_id)))}
            {g.caps.map((lr) => lineRow(lr, lr.nature === 'common' ? t('bu.commonCap') : `${catName(lr.line.category_id)} · ${t('bu.dedicated')}`))}
          </section>
        ))}

        <section className="card bu-macro">
          <div className="row bu-macro-head"><span className="bu-macro-name">{t('bu.incomes')}</span><span className="num strong pos">{money(r.incomeBudget)}</span></div>
          {incomes.map((lr) => lineRow(lr, catName(lr.line.category_id)))}
        </section>

        {missing.length > 0 && (
          <section className="card">
            <h2>{t('bu.missing')}</h2>
            <p className="muted small">{t('bu.missing.hint')}</p>
            {missing.map((c) => (
              <div key={c.id} className="row">
                <span className="small">{c.name}</span>
                <button type="button" className="ghost" onClick={() => void addLine(c.id)}><i className="ph ph-plus" aria-hidden="true" /> {t('bu.add')}</button>
              </div>
            ))}
          </section>
        )}

        <ReserveCard key={data.budget.id + data.budget.client_modified_at} db={db} budget={data.budget} extraCents={extra} money={money} onSync={onSync} />

        <section className="card">
          <div className="row"><span className="small muted">{t('bu.expenseTotal')}</span><span className="num">{money(r.expenseBudget)}</span></div>
          <div className="row"><span className="strong">{t('bu.result')}</span><span className={`num strong ${r.result >= 0 ? 'pos' : 'neg'}`}>{signed(r.result)}</span></div>
          {incomes.length > 1 && r.primaryIncome && (
            <div className="row"><span className="small muted">{t('bu.resultPrimary', { name: primaryName })}</span><span className={`num small ${r.resultPrimary >= 0 ? 'pos' : 'neg'}`}>{signed(r.resultPrimary)}</span></div>
          )}
        </section>

        <button type="button" className="primary" onClick={() => void setStatus('approved')}>
          {confirm === 'approve' ? (toReview > 0 ? t('bu.approve.confirmTodo', { n: toReview }) : t('bu.approve.confirm')) : t('bu.approve')}
        </button>
        <p className="muted small center">{t('bu.approve.hint')}</p>
        <BottomBar nav={nav} />
      </main>
    );
  }

  // ----- lettura (approvato) ------------------------------------------------
  return (
    <main className="page with-bar">
      {header}
      <SyncPill pending={pending} onClick={() => nav.go({ name: 'settings' })} />
      <p className="muted small">{t('bu.approvedOn', { date: new Date(data.budget.approved_at!).toLocaleDateString(locale, { dateStyle: 'medium' }) })}</p>
      <section className="card">
        <div className="row"><span className="small muted">{t('bu.result')}</span><span className={`num ${r.result >= 0 ? 'pos' : 'neg'}`}>{signed(r.result)}</span></div>
        {incomes.length > 1 && r.primaryIncome && (
          <div className="row"><span className="small muted">{t('bu.resultPrimary', { name: primaryName })}</span><span className={`num small ${r.resultPrimary >= 0 ? 'pos' : 'neg'}`}>{signed(r.resultPrimary)}</span></div>
        )}
        <div className="row bu-sep"><span className="strong">{t('bu.resultToDate')}</span><span className={`num strong ${r.resultToDate >= 0 ? 'pos' : 'neg'}`}>{signed(r.resultToDate)}</span></div>
      </section>

      {groups.map((g) => (
        <MacroCard key={g.macro.id} g={g} money={money} onOpen={() => nav.go({ name: 'budgetMacro', year, macroId: g.macro.id })} />
      ))}

      <section className="card">
        <div className="row"><span className="strong small">{t('bu.incomes')}</span><span className="num small">{t('bu.ofBudget', { actual: money(incomes.reduce((s, x) => s + x.actual, 0)), budget: money(r.incomeBudget) })}</span></div>
        {incomes.map((lr) => (
          <div key={lr.line.id} className="row"><span className="small muted">{master.categoryById.get(lr.line.category_id!)?.name}</span><span className="num small">{t('bu.ofBudget', { actual: money(lr.actual), budget: money(lr.budget) })}</span></div>
        ))}
        {r.extraIncome > 0 && <div className="row bu-sep"><span className="small muted">{t('bu.extra')}</span><span className="num small pos">+{money(r.extraIncome)}</span></div>}
      </section>

      <section className="card">
        <div className="row"><span className="small">{t('bu.reserve')}</span><span className="num small">{money(r.reserve)}</span></div>
        <p className="muted tiny">{t('bu.reserve.later')}</p>
        {r.outOfBudget > 0 && <div className="row bu-sep"><span className="small">{t('bu.outOfBudget')}</span><span className="num small bu-warn">{money(r.outOfBudget)}</span></div>}
      </section>

      {storico}
      <button type="button" className="secondary" onClick={() => void setStatus('draft')}>
        {confirm === 'reopen' ? t('bu.reopen.confirm') : t('bu.reopen')}
      </button>
      <BottomBar nav={nav} />
    </main>
  );
}

function kindOf(g: MacroReading): 'forecast' | 'cap' | 'mixed' {
  if (g.forecast.length > 0 && g.caps.length > 0) return 'mixed';
  return g.caps.length > 0 ? 'cap' : 'forecast';
}

/** Numeri della lettura: budget, consuntivo, impegnato, disponibile. */
export function Numbers({ budget, actual, committed, available, money }: { budget: number; actual: number; committed: number; available: number; money: (c: number) => string }) {
  const { t } = useI18n();
  const cell = (label: string, v: number, cls = '') => (
    <span className="bu-num"><span className="muted tiny">{label}</span><span className={`num small ${cls}`}>{money(v)}</span></span>
  );
  return (
    <div className="bu-nums">
      {cell(t('bu.n.budget'), budget)}
      {cell(t('bu.n.actual'), actual)}
      {cell(t('bu.n.committed'), committed)}
      {cell(t('bu.n.available'), available, available < 0 ? 'bu-warn' : '')}
    </div>
  );
}

export function UseBar({ budget, actual, committed, color, over }: { budget: number; actual: number; committed: number; color: string; over?: boolean }) {
  const pct = (v: number) => (budget > 0 ? Math.min(100, Math.max(0, (v / budget) * 100)) : v > 0 ? 100 : 0);
  const a = pct(actual);
  const c = Math.min(100 - a, pct(committed));
  return (
    <span className={over ? 'bar bu-bar over' : 'bar bu-bar'} aria-hidden="true">
      <span style={{ width: `${a}%`, background: color }} />
      <span style={{ width: `${c}%`, background: color, opacity: 0.4 }} />
    </span>
  );
}

/** Riga di sintesi di un tetto: budget YTD, scostamento, quanto spendere nel mese. */
export function CapFacts({ lr, money }: { lr: LineReading; money: (c: number) => string }) {
  const { t } = useI18n();
  if (lr.ytdBudget === null) return null;
  const d = lr.ytdDelta ?? 0;
  return (
    <>
      <div className="row bu-fact">
        <span className="muted tiny">{t('bu.ytd', { budget: money(lr.ytdBudget), actual: money(lr.actual) })}</span>
        <span className={`tiny num ${d > 0 ? 'bu-warn' : 'pos'}`}>{d > 0 ? t('bu.ytdOver', { v: money(d) }) : d < 0 ? t('bu.ytdUnder', { v: money(-d) }) : t('bu.ytdOn')}</span>
      </div>
      {lr.perMonth !== null && (
        <div className="row bu-fact"><span className="muted tiny">{t('bu.perMonth')}</span><span className="tiny num">{money(lr.perMonth)}</span></div>
      )}
    </>
  );
}

function MacroCard({ g, money, onOpen }: { g: MacroReading; money: (c: number) => string; onOpen: () => void }) {
  const { t } = useI18n();
  const mixed = g.forecast.length > 0 && g.caps.length > 0;
  const sum = (rows: LineReading[], k: 'budget' | 'actual' | 'committed' | 'available') => rows.reduce((s, r) => s + r[k], 0);
  const singleCap = g.caps.length === 1 ? g.caps[0] : null;
  return (
    <button type="button" className="card bu-read" onClick={onOpen}>
      <span className="row bu-macro-head">
        <span className="bu-macro-name"><span className="bu-dot" style={{ background: g.macro.color }} />{g.macro.name}<span className="muted tiny">{t(`bu.kind.${kindOf(g)}`)}</span></span>
        <i className="ph ph-caret-right muted" aria-hidden="true" />
      </span>
      <Numbers budget={g.budget} actual={g.actual} committed={g.committed} available={g.available} money={money} />
      <UseBar budget={g.budget} actual={g.actual} committed={g.committed} color={g.macro.color} over={!!g.overCap} />
      {mixed && (
        <>
          <span className="row bu-fact"><span className="muted tiny">{t('bu.part.forecast')}</span><span className="tiny num">{t('bu.partNums', { budget: money(sum(g.forecast, 'budget')), avail: money(sum(g.forecast, 'available')) })}</span></span>
          <span className="row bu-fact"><span className="muted tiny">{t('bu.part.cap')}</span><span className="tiny num">{t('bu.partNums', { budget: money(sum(g.caps, 'budget')), avail: money(sum(g.caps, 'available')) })}</span></span>
        </>
      )}
      {singleCap && !mixed && <CapFacts lr={singleCap} money={money} />}
      {g.overCap && g.overCap.nature === 'dedicated' && (
        <span className="bu-alert tiny"><i className="ph ph-warning" aria-hidden="true" /> {t('bu.overDedicated')}</span>
      )}
      {g.overCap && g.overCap.nature === 'common' && (
        <span className="bu-alert tiny"><i className="ph ph-warning" aria-hidden="true" /> {t('bu.overCommon', { v: money(-g.overCap.available) })}</span>
      )}
    </button>
  );
}

/** Riserva per gli imprevisti: attenuazione delle straordinarie dell'anno prima, o importo a mano. */
function ReserveCard({ db, budget, extraCents, money, onSync }: { db: QuadraDB; budget: NonNullable<ReturnType<typeof useBudgetData>['budget']>; extraCents: number; money: (c: number) => string; onSync: () => void }) {
  const { t } = useI18n();
  const [pct, setPct] = useState(String(budget.reserve_pct ?? 50));
  const [amount, setAmount] = useState(String(Math.round(budget.reserve_original)));
  const save = (reserve: number, p: number | null) => writeBudget(db, { budgets: [{ ...budget, reserve_original: reserve, reserve_pct: p }] }).then(onSync);
  return (
    <section className="card">
      <div className="row"><h2>{t('bu.reserve')}</h2><span className="num strong">{money(toCents(budget.reserve_original))}</span></div>
      <p className="muted small">{t('bu.reserve.hint', { extra: money(extraCents) })}</p>
      <div className="row-fields">
        <label className="grow">{t('bu.reserve.pct')}
          <input inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)}
            onBlur={() => { const p = Math.max(0, Math.min(100, Number(pct.replace(',', '.')) || 0)); setPct(String(p)); setAmount(String(Math.round((extraCents * p) / 10000))); void save(Math.round((extraCents * p) / 100) / 100, p); }} />
        </label>
        <label className="grow">{t('bu.reserve.amount')}
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
            onBlur={() => { const v = Math.max(0, Number(amount.replace(/\./g, '').replace(',', '.')) || 0); void save(Math.round(v * 100) / 100, null); }} />
        </label>
      </div>
    </section>
  );
}

