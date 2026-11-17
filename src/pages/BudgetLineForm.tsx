import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  guideShares, historyOfLine, isUniform, membersOf, monthlyHistory, natureOf, profileFromMonths, programmedOfLine,
  proposeIntegration, setMonthWeight, uniformProfile,
} from '../lib/budget';
import { useBudgetData } from '../lib/budgetData';
import { writeBudget } from '../lib/budgetWrite';
import { parseAmount } from '../lib/csv';
import type { QuadraDB } from '../lib/db';
import { todayISO } from '../lib/dates';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { blankSync } from '../lib/masterWrite';
import { toCents } from '../lib/money';
import type { BudgetLine, BudgetSource } from '../lib/types';

const MONTHS = 'GFMAMGLASOND';

/** Scheda di una voce: programmato, integrazione con la sua fonte, riferimenti; per i tetti il profilo e i tetti dedicati. */
export function BudgetLineForm({ db, master, userId, id, currency, onBack, onDone, onSync }: {
  db: QuadraDB;
  master: MasterData;
  userId: string;
  id: string;
  currency: string;
  onBack: () => void;
  onDone: (text: string) => void;
  onSync: () => void;
}) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const row = useLiveQuery(() => db.budgetLines.get(id), [db, id]);
  const head = useLiveQuery(() => (row ? db.budgets.get(row.budget_id) : undefined), [db, row?.budget_id]);
  const year = head?.year ?? Number(today.slice(0, 4));
  const data = useBudgetData(db, year, today, master.categoryById, onSync);
  if (!row || !head || !data.ready || !master.ready) return <main className="page" aria-busy="true" />;
  return <Form key={row.id} {...{ db, master, userId, currency, onBack, onDone, onSync, row, data, locked: head.status === 'approved', year, t, locale }} />;
}

function Form({ db, master, userId, currency, onBack, onDone, onSync, row, data, locked, year, t, locale }: {
  db: QuadraDB; master: MasterData; userId: string; currency: string; onBack: () => void; onDone: (text: string) => void; onSync: () => void;
  row: BudgetLine; data: ReturnType<typeof useBudgetData>; locked: boolean; year: number;
  t: ReturnType<typeof useI18n>['t']; locale: string;
}) {
  const nature = natureOf(row, master.categoryById, master.macroById);
  const isCap = nature === 'common' || nature === 'dedicated';
  const members = membersOf(row, data.lines, master.categoryById);
  const programmed = programmedOfLine(row, data.lines, master.categoryById, data.programmed);
  const base = historyOfLine(row, data.lines, data.refs, master.categoryById, year);

  const [source, setSource] = useState<BudgetSource>(row.source);
  const [pct, setPct] = useState(String(row.adjust_pct ?? 0));
  const [amount, setAmount] = useState(row.source === 'history' ? '' : formatPlain(toCents(row.integration_original), locale));
  const [note, setNote] = useState(row.note ?? '');
  const [profile, setProfile] = useState<number[]>(row.monthly_profile ?? uniformProfile());
  const [lockedMonths, setLockedMonths] = useState<boolean[]>(() => {
    const p = row.monthly_profile;
    if (!p) return Array(12).fill(false);
    // un mese diverso dal valore più frequente è stato ritoccato a mano
    const counts = new Map<number, number>();
    p.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return p.map((x) => x !== common);
  });
  const [editing, setEditing] = useState<number | null>(null);
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);

  const money = (cents: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0, useGrouping: 'always' }).format(cents / 100);

  const pctNum = Number(pct.replace(',', '.'));
  const pctOk = Number.isFinite(pctNum) && pctNum > -100;
  const typed = parseAmount(amount || '0');
  const integration = source === 'history'
    ? (base !== null && pctOk ? proposeIntegration(base, pctNum, programmed) : 0)
    : Math.max(0, typed ?? 0);
  const invalid = (source === 'history' && (base === null || !pctOk)) || (source !== 'history' && (typed === null || typed < 0));
  const total = programmed + integration;

  const itemsHere = data.items.filter((i) => members.includes(i.categoryId));
  const actual = members.reduce((s, c) => s + (data.actuals.actual.get(c) ?? 0), 0);
  const name = row.category_id ? master.categoryById.get(row.category_id)?.name ?? '' : master.macroById.get(row.macro_id!)?.name ?? '';
  const macroId = row.macro_id ?? master.categoryById.get(row.category_id!)?.macro_id;
  const histMonths = useMemo(() => monthlyHistory(data.refs, members, year - 1), [data.refs, members, year]);
  const fromHistory = profileFromMonths(histMonths);

  // tetti dedicati: dalla scheda del tetto comune si staccano e si riattaccano le categorie
  const discCats = row.macro_id
    ? master.categories.filter((c) => c.macro_id === row.macro_id && c.flag === 'discretionary')
    : [];
  const dedicated = new Map(data.lines.filter((l) => l.category_id).map((l) => [l.category_id!, l]));
  const shares = guideShares(members, data.refs, year - 1);

  async function toggleDedicated(categoryId: string) {
    const existing = dedicated.get(categoryId);
    if (existing) {
      await writeBudget(db, { lines: [{ ...existing, deleted_at: new Date().toISOString() }] });
      onSync();
      return;
    }
    // una riga cancellata in precedenza si riattiva (resta una sola riga per categoria)
    const old = data.allLines.find((l) => l.category_id === categoryId);
    const fresh: BudgetLine = old
      ? { ...old, deleted_at: null, reviewed: false }
      : {
        ...blankSync(userId), budget_id: row.budget_id, category_id: categoryId, macro_id: null, source: 'manual', history_base: null,
        adjust_pct: null, programmed_original: (data.programmed.get(categoryId) ?? 0) / 100, integration_original: 0,
        programmed_revised: null, integration_revised: null, monthly_profile: null, reviewed: false, note: null,
      };
    // le voci del tetto comune ancora da rivedere si ricalcolano da sole (bozza viva)
    await writeBudget(db, { lines: [fresh] });
    onSync();
  }

  function pickMonth(i: number) {
    if (locked) return;
    setEditing(i);
    setWeight(String(profile[i]).replace('.', ','));
  }
  function applyWeight() {
    if (editing === null) return;
    const v = Number(weight.replace(',', '.'));
    if (!Number.isFinite(v) || v < 0) return;
    const next = setMonthWeight(profile, lockedMonths, editing, v);
    setProfile(next);
    setLockedMonths(lockedMonths.map((x, i) => x || i === editing));
    setEditing(null);
  }

  async function save() {
    if (invalid || busy || locked) return;
    setBusy(true);
    const next: BudgetLine = {
      ...row,
      source,
      history_base: source === 'history' && base !== null ? base / 100 : null,
      adjust_pct: source === 'history' ? pctNum : null,
      programmed_original: programmed / 100,
      integration_original: integration / 100,
      monthly_profile: isCap && !isUniform(profile) ? profile : null,
      note: note.trim() || null,
      reviewed: true,
    };
    await writeBudget(db, { lines: [next] });
    onDone(t('bu.toast.saved', { name }));
  }

  return (
    <main className="page bu-form">
      <header className="topbar">
        <button type="button" className="ghost" onClick={onBack}>{t('common.back')}</button>
        <h1>{name}</h1>
        {locked ? <span style={{ width: 64 }} /> : <button type="button" className="ghost strong" disabled={invalid || busy} onClick={() => void save()}>{t('bu.confirm')}</button>}
      </header>
      <div className="row">
        <span className="badge">{t(`bu.nature.${nature}`)}</span>
        <span className="muted small">{t('bu.ofYear', { year })}</span>
      </div>
      {locked && <p className="muted small">{t('bu.locked')}</p>}

      <section className="card">
        <div className="row"><h2>{t('bu.programmed')}</h2><span className="muted tiny">{t('bu.programmed.hint')}</span></div>
        {itemsHere.length === 0 && <p className="muted small">{t('bu.programmed.none')}</p>}
        {itemsHere.map((i) => (
          <div key={i.recurrenceId} className="row"><span className="small">{i.name} <span className="muted tiny">· {t('bu.times', { n: i.count })}</span></span><span className="num small">{money(i.cents)}</span></div>
        ))}
        <div className="row bu-sep"><span className="small strong">{t('bu.programmed.total')}</span><span className="num small strong">{money(programmed)}</span></div>
      </section>

      <section className="card">
        <h2>{t('bu.integration')}</h2>
        <div className="segmented md-wide" role="group" aria-label={t('bu.source')}>
          {(['history', 'known', 'manual'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={source === s} disabled={locked} onClick={() => setSource(s)}>{t(`bu.src.${s}`)}</button>
          ))}
        </div>
        {source === 'history' ? (
          base === null ? (
            <p className="small bu-warn">{t('bu.noHistory', { year: year - 1 })}</p>
          ) : (
            <>
              <div className="row"><span className="small muted">{t('bu.history.base', { year: year - 1 })}</span><span className="num small">{money(base)}</span></div>
              <label>{t('bu.adjust')}
                <input inputMode="decimal" value={pct} disabled={locked} onChange={(e) => setPct(e.target.value)} />
              </label>
              <div className="row"><span className="small muted">{t('bu.history.adjusted')}</span><span className="num small">{money(Math.round(base * (1 + (pctOk ? pctNum : 0) / 100)))}</span></div>
              {programmed > 0 && <div className="row"><span className="small muted">{t('bu.minusProgrammed')}</span><span className="num small">−{money(programmed)}</span></div>}
              {Math.round(base * (1 + (pctOk ? pctNum : 0) / 100)) < programmed && (
                <p className="small bu-warn">{t('bu.progOver', { v: money(programmed - Math.round(base * (1 + pctNum / 100))) })}</p>
              )}
            </>
          )
        ) : (
          <>
            <label>{t(source === 'known' ? 'bu.amount.known' : 'bu.amount.manual')}
              <input inputMode="decimal" value={amount} disabled={locked} placeholder="0" onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label>{t('bu.note')}
              <input value={note} disabled={locked} placeholder={t(source === 'known' ? 'bu.note.known' : 'bu.note.manual')} onChange={(e) => setNote(e.target.value)} />
            </label>
          </>
        )}
        <div className="row bu-sep"><span className="small strong">{t('bu.integration')}</span><span className="num small strong">{money(integration)}</span></div>
      </section>

      <section className="card">
        <div className="row"><span className="strong">{t(isCap ? 'bu.capTotal' : nature === 'income' ? 'bu.incomeTotal' : 'bu.lineTotal')}</span><span className="num strong bu-big">{money(total)}</span></div>
        <p className="muted tiny">{t('bu.formula', { prog: money(programmed), int: money(integration) })}</p>
      </section>

      {isCap && (
        <section className="card">
          <div className="row">
            <h2>{t('bu.profile')}</h2>
            {!locked && (
              <span className="row-tight">
                <button type="button" className="ghost" onClick={() => { setProfile(uniformProfile()); setLockedMonths(Array(12).fill(false)); }}>{t('bu.profile.uniform')}</button>
                {fromHistory && <button type="button" className="ghost" onClick={() => { setProfile(fromHistory); setLockedMonths(Array(12).fill(true)); }}>{t('bu.profile.history')}</button>}
              </span>
            )}
          </div>
          <div className="bu-profile">
            {profile.map((w, i) => (
              <button key={i} type="button" className={editing === i ? 'bu-month on' : 'bu-month'} aria-label={t('bu.profile.month', { month: monthName(i, locale), pct: fmtPct(w, locale) })} onClick={() => pickMonth(i)}>
                <span className="tiny num">{fmtPct(w, locale)}</span>
                <span className="bu-col" style={{ height: `${Math.max(2, (w / Math.max(...profile, 1)) * 80)}px`, background: lockedMonths[i] ? 'var(--accent)' : '#3a4a63' }} />
                <span className="tiny muted">{MONTHS[i]}</span>
              </button>
            ))}
          </div>
          {editing !== null && (
            <div className="row-fields">
              <label className="grow">{t('bu.profile.weight', { month: monthName(editing, locale) })}
                <input inputMode="decimal" value={weight} autoFocus onChange={(e) => setWeight(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyWeight()} />
              </label>
              <button type="button" className="secondary bu-apply" onClick={applyWeight}>{t('bu.profile.apply')}</button>
            </div>
          )}
          <p className="muted tiny">{t('bu.profile.hint')}</p>
        </section>
      )}

      {nature === 'common' && (
        <section className="card">
          <div className="row"><h2>{t('bu.members')}</h2><span className="muted tiny">{t('bu.members.hint')}</span></div>
          {discCats.map((c) => {
            const own = dedicated.has(c.id);
            return (
              <div key={c.id} className="row">
                <span className="small">{c.name}{!own && shares.get(c.id) ? <span className="muted tiny"> · {Math.round((shares.get(c.id) ?? 0) * 100)}%</span> : null}</span>
                <label className="bu-switch">
                  <span className="tiny">{t('bu.dedicated')}</span>
                  <input type="checkbox" role="switch" checked={own} disabled={locked} onChange={() => void toggleDedicated(c.id)} />
                </label>
              </div>
            );
          })}
          <p className="muted tiny">{t('bu.dedicated.hint')}</p>
        </section>
      )}
      {nature === 'dedicated' && !locked && macroId && (
        <button type="button" className="secondary" onClick={() => void toggleDedicated(row.category_id!).then(onBack)}>{t('bu.backToCommon')}</button>
      )}

      <section className="card">
        <h2>{t('bu.refs')}</h2>
        <div className="row"><span className="small muted">{t('bu.ref.history', { year: year - 1 })}</span><span className="num small">{base === null ? '—' : money(base)}</span></div>
        <div className="row"><span className="small muted">{t('bu.ref.programmed')}</span><span className="num small">{money(programmed)}</span></div>
        <div className="row"><span className="small muted">{t('bu.ref.actual', { year })}</span><span className="num small">{money(actual)}</span></div>
      </section>
    </main>
  );
}

const monthName = (i: number, locale: string) => new Date(2027, i, 1).toLocaleDateString(locale, { month: 'long' });
const fmtPct = (w: number, locale: string) => `${w.toLocaleString(locale, { maximumFractionDigits: 2 })}%`;
const formatPlain = (cents: number, locale: string) => (cents / 100).toLocaleString(locale, { maximumFractionDigits: 2, useGrouping: false });
