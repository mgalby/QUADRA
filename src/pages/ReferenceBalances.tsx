import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { writeBudget } from '../lib/budgetWrite';
import { parseAmount } from '../lib/csv';
import type { QuadraDB } from '../lib/db';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { blankSync } from '../lib/masterWrite';
import { formatMoney, toCents } from '../lib/money';
import type { ReferenceBalance, TxKind } from '../lib/types';

/**
 * Storico di riferimento: totali letti a mano da un'altra app (Monefy), per categoria
 * o per macro, per anno o per mese. Una "straordinaria" resta fuori dalla base dello
 * storico e serve a proporre la riserva.
 */
export function ReferenceBalances({ db, master, userId, year: startYear, currency, onBack, onSync }: {
  db: QuadraDB;
  master: MasterData;
  userId: string;
  year: number;
  currency: string;
  onBack: () => void;
  onSync: () => void;
}) {
  const { t, locale } = useI18n();
  const [year, setYear] = useState(startYear);
  const [kind, setKind] = useState<TxKind>('expense');
  const [editing, setEditing] = useState<ReferenceBalance | 'new' | null>(null);
  const all = useLiveQuery(() => db.refBalances.where('year').equals(year).toArray(), [db, year]);
  const money = (cents: number) => formatMoney(cents, currency, locale);

  const kindOf = (r: ReferenceBalance): TxKind => {
    const macroId = r.macro_id ?? master.categoryById.get(r.category_id ?? '')?.macro_id;
    return master.macroById.get(macroId ?? '')?.tx_kind ?? 'expense';
  };
  const rows = useMemo(
    () => (all ?? []).filter((r) => !r.deleted_at && kindOf(r) === kind).sort((a, b) => label(a).localeCompare(label(b)) || (a.month ?? 0) - (b.month ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, kind, master],
  );
  function label(r: ReferenceBalance): string {
    if (r.category_id) return master.categoryById.get(r.category_id)?.name ?? '?';
    return `${master.macroById.get(r.macro_id ?? '')?.name ?? '?'} · ${t('ref.wholeMacro')}`;
  }
  const colorOf = (r: ReferenceBalance) => master.macroById.get(r.macro_id ?? master.categoryById.get(r.category_id ?? '')?.macro_id ?? '')?.color ?? '#8B93A0';

  // il totale di controllo somma gli importi annuali; i mesi contano solo dove manca l'anno intero
  const total = useMemo(() => {
    const annualKeys = new Set(rows.filter((r) => r.month === null).map((r) => `${r.category_id ?? r.macro_id}|${r.extraordinary}`));
    return rows.filter((r) => r.month === null || !annualKeys.has(`${r.category_id ?? r.macro_id}|${r.extraordinary}`)).reduce((s, r) => s + toCents(r.amount), 0);
  }, [rows]);
  const extra = rows.filter((r) => r.extraordinary && r.month === null).reduce((s, r) => s + toCents(r.amount), 0);

  return (
    <main className="page">
      <header className="topbar">
        <button type="button" className="ghost" onClick={onBack}>{t('common.back')}</button>
        <h1>{t('ref.title')}</h1>
        <button type="button" className="icon-btn" aria-label={t('ref.new')} onClick={() => setEditing('new')}><i className="ph ph-plus" aria-hidden="true" /></button>
      </header>
      <p className="muted small">{t('ref.hint')}</p>
      <div className="row">
        <div className="segmented basis" role="group" aria-label={t('bu.year')}>
          {[startYear - 1, startYear, startYear + 1].map((y) => (
            <button key={y} type="button" aria-pressed={y === year} onClick={() => setYear(y)}>{y}</button>
          ))}
        </div>
        <div className="segmented basis" role="group" aria-label={t('ref.kind')}>
          <button type="button" className="expense" aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>{t('home.expenses')}</button>
          <button type="button" className="income" aria-pressed={kind === 'income'} onClick={() => setKind('income')}>{t('home.income')}</button>
        </div>
      </div>

      <section className="card">
        <div className="row"><span className="strong">{t(kind === 'expense' ? 'ref.total.expense' : 'ref.total.income', { year })}</span><span className="num strong">{money(total)}</span></div>
        {extra > 0 && <div className="row"><span className="small muted">{t('ref.ofWhichExtra')}</span><span className="num small bu-warn">{money(extra)}</span></div>}
        <p className="muted tiny">{t('ref.control')}</p>
      </section>

      {editing && (
        <RefForm key={editing === 'new' ? 'new' : editing.id} db={db} master={master} userId={userId} year={year} kind={kind}
          row={editing === 'new' ? null : editing} taken={rows} onClose={() => { setEditing(null); onSync(); }} />
      )}

      <section className="card bu-refs">
        {rows.length === 0 && <p className="muted small empty">{t('ref.empty', { year })}</p>}
        {rows.map((r) => (
          <button key={r.id} type="button" className="bu-ref" onClick={() => setEditing(r)}>
            <span className="bu-line-main">
              <span className="bu-line-name"><span className="bu-dot" style={{ background: colorOf(r) }} />{label(r)}{r.extraordinary && <span className="bu-src bu-extra">{t('ref.extraordinary')}</span>}</span>
              <span className="muted tiny">{[r.month ? monthName(r.month, locale) : t('ref.wholeYear'), r.note].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="num small">{money(toCents(r.amount))}</span>
          </button>
        ))}
      </section>
    </main>
  );
}

function RefForm({ db, master, userId, year, kind, row, taken, onClose }: {
  db: QuadraDB; master: MasterData; userId: string; year: number; kind: TxKind; row: ReferenceBalance | null; taken: ReferenceBalance[]; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [target, setTarget] = useState(row ? (row.category_id ? `c:${row.category_id}` : `m:${row.macro_id}`) : '');
  const [month, setMonth] = useState(row?.month ? String(row.month) : '');
  const [amount, setAmount] = useState(row ? (row.amount).toLocaleString(locale, { useGrouping: false, maximumFractionDigits: 2 }) : '');
  const [note, setNote] = useState(row?.note ?? '');
  const [extra, setExtra] = useState(row?.extraordinary ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const macros = master.macros.filter((m) => m.tx_kind === kind);
  const cents = parseAmount(amount);
  const m = month ? Number(month) : null;
  const catId = target.startsWith('c:') ? target.slice(2) : null;
  const macroId = target.startsWith('m:') ? target.slice(2) : null;
  const duplicate = taken.some((r) => r.id !== row?.id && r.year === year && r.month === m && r.category_id === catId && r.macro_id === macroId && r.extraordinary === extra);
  const problem = !target ? t('ref.err.target') : cents === null || cents < 0 ? t('ref.err.amount') : duplicate ? t('ref.err.duplicate') : null;

  async function save() {
    if (problem) return;
    const base: ReferenceBalance = row ?? { ...blankSync(userId), year, month: null, category_id: null, macro_id: null, amount: 0, extraordinary: false, origin: 'Monefy', note: null };
    await writeBudget(db, { refs: [{ ...base, year, month: m, category_id: catId, macro_id: macroId, amount: cents! / 100, extraordinary: extra, note: note.trim() || null }] });
    onClose();
  }
  async function remove() {
    if (!row) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await writeBudget(db, { refs: [{ ...row, deleted_at: new Date().toISOString() }] });
    onClose();
  }

  return (
    <section className="card form bu-refform">
      <h2>{row ? t('ref.edit') : t('ref.new')} · {year}</h2>
      <label>{t('ref.target')}
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{t('ref.pick')}</option>
          {macros.map((mac) => (
            <optgroup key={mac.id} label={mac.name}>
              {master.categories.filter((c) => c.macro_id === mac.id).map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}
              <option value={`m:${mac.id}`}>{mac.name} · {t('ref.wholeMacro')}</option>
            </optgroup>
          ))}
        </select>
      </label>
      <div className="row-fields">
        <label className="grow">{t('ref.month')}
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">{t('ref.wholeYear')}</option>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={String(i + 1)}>{monthName(i + 1, locale)}</option>)}
          </select>
        </label>
        <label className="grow">{t('ref.amount')}
          <input inputMode="decimal" value={amount} placeholder="0,00" onChange={(e) => setAmount(e.target.value)} />
        </label>
      </div>
      <label>{t('ref.note')}
        <input value={note} placeholder={t('ref.note.ph')} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="bu-switch wide">
        <span className="small">{t('ref.extraordinary')} <span className="muted tiny">{t('ref.extraordinary.hint')}</span></span>
        <input type="checkbox" role="switch" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
      </label>
      {problem && target && <p className="error">{problem}</p>}
      <div className="row">
        {row ? <button type="button" className="danger" onClick={() => void remove()}>{confirmDelete ? t('ref.delete.confirm') : t('ref.delete')}</button> : <span />}
        <span className="row-tight">
          <button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="primary bu-save" disabled={!!problem} onClick={() => void save()}>{t('common.save')}</button>
        </span>
      </div>
    </section>
  );
}

const monthName = (m: number, locale: string) => new Date(2027, m - 1, 1).toLocaleDateString(locale, { month: 'long' });
